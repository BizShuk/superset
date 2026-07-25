import * as vscode from "vscode";
import * as path from "path";
import type { ProjectTodoItem } from "./types";
import type { ProjectsTodoStore } from "./projectsTodoStore";
import { isArchivedSubsection, cleanTags, isArchivedTask } from "../todo/parser";
import { filterCompleted, applyPriorityFilter } from "../todo/todoTreeProvider";
import { makePlansSection, planInfoToTodoItem } from "../todo/plansSource";
import {
    countPending,
    sortSiblings,
    extractPriorityTag,
    stripMarkdownLink,
    priorityIconPath,
    dispatchContextValue,
} from "../todoEngine";
import { extractLink } from "../todoEngine/linkUtils";

/**
 * vscode-bound TreeDataProvider for the Projects TODO list.
 * Reads from a ProjectsTodoStore (which reads from multiple README.todo files).
 */
export class ProjectsTodoTreeProvider
    implements vscode.TreeDataProvider<ProjectTodoItem>
{
    private readonly emitter = new vscode.EventEmitter<
        ProjectTodoItem | ProjectTodoItem[] | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;

    private unsubscribeStore?: () => void;
    private showCompleted = false;
    private enabledPriorities = new Set<"P0" | "P1" | "P2">();
    private viewType: "section" | "priority" | "file" = "section";

    constructor(
        private readonly store: ProjectsTodoStore,
        /**
         * 當前開啟的 VSCode workspace 絕對路徑。TreeProvider 用來把
         * workspace sub-project 的 `projectPath` 折算成相對路徑
         * (例如 `src/todo` 而不是 `todo`),讓巢狀結構一眼可見。
         * 未提供時,workspace section 仍會出現,但 sub-project 退用
         * basename(對齊既有 `~/projects` project row 行為)。
         */
        private readonly workspaceRoot?: string,
        private readonly extensionUri?: vscode.Uri,
        /**
         * Root rendering mode:
         * - projects: existing ~/projects overview view
         * - workspace: current-workspace-only sub-panel view
         */
        private readonly rootMode: "projects" | "workspace" = "projects",
        /**
         * Optional override for the workspace empty-state placeholder
         * text. Panels that mount this provider with their own copy
         * (e.g. the SuperSet TODO panel) pass a custom string;
         * `superset.workspaceTodo` keeps the default.
         */
        private readonly emptyStateCopy?: string,
    ) {}

    start(): void {
        if (this.unsubscribeStore) return;
        this.unsubscribeStore = this.store.onDidChange(() => {
            this.refresh();
        });
        // Push initial viewType so the View button menu wiring
        // (`view == superset.todo && superset.todo.viewType == '...'`)
        // resolves correctly on first activation. Panels that don't
        // expose view switching (e.g. `superset.workspaceTodo`) leave
        // `viewType` at the default `"section"` and the context key is
        // effectively a no-op for them.
        void vscode.commands.executeCommand(
            "setContext",
            "superset.todo.viewType",
            this.viewType,
        );
    }

    setViewType(t: "section" | "priority" | "file"): void {
        if (this.viewType === t) return;
        this.viewType = t;
        void vscode.commands.executeCommand(
            "setContext",
            "superset.todo.viewType",
            t,
        );
        this.refresh();
    }

    getViewType(): "section" | "priority" | "file" {
        return this.viewType;
    }

    stop(): void {
        this.unsubscribeStore?.();
        this.unsubscribeStore = undefined;
    }

    refresh(): void {
        this.emitter.fire(undefined);
    }

    toggleShowCompleted(): boolean {
        this.showCompleted = !this.showCompleted;
        this.refresh();
        return this.showCompleted;
    }

    isShowingCompleted(): boolean {
        return this.showCompleted;
    }

    togglePriorityFilter(p: "P0" | "P1" | "P2"): boolean {
        if (this.enabledPriorities.has(p)) {
            this.enabledPriorities.delete(p);
        } else {
            this.enabledPriorities.add(p);
        }
        this.refresh();
        return this.enabledPriorities.has(p);
    }

    isPriorityEnabled(p: "P0" | "P1" | "P2"): boolean {
        return this.enabledPriorities.has(p);
    }

    getTreeItem(element: ProjectTodoItem): vscode.TreeItem {
        // 0. Plan item — synthetic entry from plans/<file>.md.
        // Symmetric with the local `todoPlan` rendering: file icon,
        // description = title, no `command` (open happens via the
        // inline menu icon wired in package.json). The native
        // checkbox column routes clicks to the projects-side
        // complete-plan command via onDidChangeCheckboxState.
        if (element.kind === "plan") {
            const item = new vscode.TreeItem(element.text);
            item.iconPath = new vscode.ThemeIcon("file-text");
            item.description = element.description;
            item.tooltip = `${element.description ?? element.text}\n${element.filePath ?? ""}`;
            item.collapsibleState = vscode.TreeItemCollapsibleState.None;
            item.contextValue = "projectsTodoPlan";
            item.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
            return item;
        }

        // 1. If it's a project section node (~/projects projects use
        // line === -1, workspace sub-projects use line === -2 so they
        // can be rendered with the same folder/pending semantics while
        // carrying a relative path label instead of a basename).
        const isProjectNode = (element.line === -1 || element.line === -2) &&
            element.projectPath &&
            // ~/projects project rows: text === basename(projectPath)
            // Workspace sub-project rows: text === path.relative(workspaceRoot, projectPath)
            (element.text === path.basename(element.projectPath) ||
                (element.line === -2 && element.text.includes(path.sep) && this.workspaceRoot !== undefined));
        if (isProjectNode) {
            const item = new vscode.TreeItem(element.text);
            item.iconPath = new vscode.ThemeIcon("folder");
            // Show pending (unchecked) task count as description.
            // Children are already filtered by showCompleted / priority,
            // so the count naturally excludes archived items when the
            // hide-completed filter is active. When the current filter
            // excludes every task in this project, children is empty and
            // the count is 0 — that's the "no pending tasks inside" state
            // the overview still surfaces (see getChildren).
            const pending = countPending(element.children);
            item.description = `${pending} pending`;
            item.tooltip = element.projectPath;
            // Always default the project row to Collapsed. The overview
            // is a flat list of every live project — auto-expanding each
            // one explodes into 100+ rows on a 50-project workspace and
            // buries the project count. Users expand the ones they care
            // about. Empty children would also collapse here, but the
            // Collapsed default already covers both cases.
            item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            item.contextValue = "projectsTodoProject";
            // No item.command — clicking the row text folds/unfolds the section.
            // Opening the project is an inline button (see package.json menus).
            return item;
        }

        // 1b. The top-level "Workspace Todo (Current)" wrapper section —
        // visually distinct from ~/projects project rows so users can
        // tell at a glance that these sub-projects come from the
        // open workspace rather than the global ~/projects scan.
        // **預設 Expanded** — 跟 project row 的 Collapsed 預設刻意
        // 不同:workspace section 是這個 panel 的固定入口,使用者打開
        // overview 第一眼就該看到「目前 workspace 內有什麼」,不要讓
        // 他們以為面板還沒掃或不存在。
        if (element.text === "Workspace Todo (Current)" && element.kind === "section" && !element.projectPath) {
            const item = new vscode.TreeItem(element.text);
            item.iconPath = new vscode.ThemeIcon("root-folder");
            // 真實 sub-project 數量在 makeWorkspaceSection 加入
            // placeholder 之前快照成 `element.description`,這裡直接
            // 採用 — placeholder 不算 sub-project。
            item.description = element.description ?? "0 sub-projects";
            item.tooltip =
                element.children?.some((c) => c.kind === "list" && c.line === 0)
                    ? "No README.todo files found in this workspace — drop a README.todo into a subdirectory to start"
                    : "Recursive scan: every README.todo under the open workspace root";
            // **Expanded by default** — make the workspace's todo content
            // immediately visible (vs project rows which stay Collapsed
            // to avoid an unwieldy overview on 50-project workspaces).
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            // Reserved contextValue for future menu wiring (e.g. a
            // refresh button) — no menu entries are bound to it yet.
            item.contextValue = "projectsTodoWorkspaceSection";
            return item;
        }

        // 2. If it's a normal section inside a project
        if (element.kind === "section") {
            // Synthetic "Plans" section: file-code icon and a plain
            // plan-count description (no `N ◐` badge since plans are
            // not actionable). Same handling as the local TODO panel.
            if (element.text === "Plans") {
                const item = new vscode.TreeItem(element.text);
                item.iconPath = new vscode.ThemeIcon("file-code");
                const planCount = element.children?.length ?? 0;
                item.description = `${planCount} plan${planCount === 1 ? "" : "s"}`;
                item.tooltip = "Design documents under ./plans/";
                item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                item.contextValue = "projectsTodoPlansSection";
                return item;
            }
            const item = new vscode.TreeItem(element.text);
            item.iconPath = new vscode.ThemeIcon("tag");
            if (element.text === "README.todo") {
                item.iconPath = new vscode.ThemeIcon("file-text");
            } else if (element.text.includes(".")) {
                item.iconPath = new vscode.ThemeIcon("file");
            }
            // Compute contextValue once and reuse for the badge decision
            // below and the final contextValue assignment.
            const sectionContext = this.computeSectionContextValue(element);
            // Append a half-circle badge showing the count of pending
            // (unchecked) checkboxes. Children were already filtered by
            // showCompleted / priority in getChildren, so the count
            // respects the active filter. Archive sub-sections are
            // skipped — by definition they hold finished work, so a
            // "0 ◐" badge is noise rather than signal.
            if (sectionContext !== "projectsTodoSectionArchived") {
                const pending = countPending(element.children);
                item.description = `${pending} ◐`;
            }
            item.tooltip = element.text;
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            item.contextValue = sectionContext;
            return item;
        }

        // 3. List or Checkbox items
        let labelText = element.text;
        labelText = cleanTags(labelText);

        const { text: priorityStripped, priority } = extractPriorityTag(labelText);
        const { text: labelTextCleaned, hasLink } = stripMarkdownLink(priorityStripped);

        const item = new vscode.TreeItem(labelTextCleaned);

        if (element.kind === "list") {
            const priorityIcon = priorityIconPath(this.extensionUri, priority);
            if (priorityIcon) {
                item.iconPath = priorityIcon;
            } else {
                item.iconPath = new vscode.ThemeIcon(
                    "dash",
                    new vscode.ThemeColor("descriptionForeground")
                );
            }
            item.tooltip = cleanTags(element.text);
            item.collapsibleState =
                element.children && element.children.length > 0
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None;

            const isArchived =
                isArchivedTask(element.text) ||
                element.parentSection?.toLowerCase() === "archive";
            item.contextValue = dispatchContextValue({
                prefix: "projectsTodo",
                kind: "list",
                isArchived,
                hasLink,
            });
            return item;
        }

        // Else: checkbox
        const priorityIcon = priorityIconPath(this.extensionUri, priority);
        if (priorityIcon && !element.checked) {
            item.iconPath = priorityIcon;
        } else {
            item.iconPath = new vscode.ThemeIcon(
                element.checked ? "pass" : "circle-large-outline",
                element.checked
                    ? new vscode.ThemeColor("charts.green")
                    : new vscode.ThemeColor("charts.yellow")
            );
        }

        item.description = element.checked ? "✓" : undefined;
        item.tooltip = element.checked
            ? `${cleanTags(element.text)} (completed)`
            : `${cleanTags(element.text)} (pending)`;
        item.collapsibleState =
            element.children && element.children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None;

        item.checkboxState = element.checked
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked;

        const isArchived =
            isArchivedTask(element.text) ||
            element.parentSection?.toLowerCase() === "archive";
        item.contextValue = dispatchContextValue({
            prefix: "projectsTodo",
            kind: "checkbox",
            isArchived,
            hasLink,
        });
        return item;
    }

    private computeSectionContextValue(element: ProjectTodoItem): string {
        if (element.level === undefined) return "projectsTodoSection";
        if (element.level === 2 && element.text.toLowerCase() === "archive") return "projectsTodoSection";
        
        const subStore = this.store.getStore(element.projectPath);
        if (subStore && isArchivedSubsection(subStore.getItems(), element)) {
            return "projectsTodoSectionArchived";
        }
        return "projectsTodoSectionArchivable";
    }

    getChildren(element?: ProjectTodoItem): vscode.ProviderResult<ProjectTodoItem[]> {
        if (element) {
            return sortSiblings(element.children || []);
        }

        const workspaceStores = this.store.getWorkspaceStores();

        // Workspace view mode: this provider is mounted as its own
        // VSCode sub-panel under the Overall viewContainer, so the view
        // title itself is already the foldable "Workspace TODO" panel.
        // Therefore root children should be the workspace sub-projects
        // (or empty-state placeholder) directly — NOT a synthetic wrapper
        // row inside the tree.
        if (this.rootMode === "workspace") {
            if (!this.workspaceRoot) return [];
            // Section view is the default and the only mode exposed to
            // `superset.workspaceTodo` (the Overall view's separate
            // workspace panel never installs view-switch commands).
            // Priority/file views are reachable from the SuperSet TODO
            // panel via the View buttons that ship with the local TODO
            // feature.
            if (this.viewType === "priority") {
                return this.buildWorkspacePriorityGroups(workspaceStores);
            }
            if (this.viewType === "file") {
                return this.buildWorkspaceFileGroups(workspaceStores);
            }
            return (
                this.makeWorkspaceSection(
                    workspaceStores,
                    this.emptyStateCopy,
                ).children ?? []
            );
        }

        const projectItems: ProjectTodoItem[] = [];

        // Projects view mode: existing ~/projects overview only. The
        // workspace scan is intentionally NOT rendered here; it has its
        // own sibling VSCode view panel (`superset.workspaceTodo`) so each
        // panel can fold independently at the workbench level.

        // Project rows — only projects that actually have a README.todo.
        // Each project surfaces its own `plans/*.md` as a synthetic
        // "Plans" sub-section under its row, appended after the
        // README.todo sections so users can drill into a project and see
        // its design docs locally. Overview 不再有頂層 merged Plans row
        // (見 CLAUDE.md invariant);plans 只在各自的 per-project scope
        // 出現,跨專案的 "what's happening" snapshot 走 `plansSource`
        // 自己的 panel,不混入本 view。
        //
        // 路徑若同時被 workspace scan 收為 sub-project (例如
        // `~/projects/tmp/superset` 既是 ~/projects project 也是
        // workspace root),由 workspace panel 顯示,這裡 suppress
        // 避免同一份 `README.todo` 在兩個 panel 出現。
        for (const [projectPath, store] of this.store.getStores()) {
            if (workspaceStores.has(projectPath)) {
                // Workspace panel already covers this — skip the
                // ~/projects duplicate so the same content isn't
                // rendered twice.
                continue;
            }
            const projectName = path.basename(projectPath);
            const raw = store.getItems();

            // Apply filtering logic using standard filters
            const completedFiltered = this.showCompleted ? raw : filterCompleted(raw);
            const filtered = applyPriorityFilter(completedFiltered, this.enabledPriorities);

            // Note: the overview intentionally surfaces EVERY project that
            // has a `README.todo`, even when the current filter (hide-completed
            // / priority) leaves zero visible items. The project row stays
            // (collapsed if its filtered children happen to be empty) so users
            // see at a glance which projects still have a todo file, regardless
            // of whether every task is checked, the file is empty, or the
            // active priority filter excludes all of this project's tasks.

            // Per-project plans: append a synthetic "Plans" section AFTER
            // the README.todo sections so users can drill into this project
            // and see its own design docs. Plans survive both filters (no
            // checked state, no priority tag — see `applyPriorityFilter` /
            // `filterCompleted` passthrough), so the section appears as
            // long as the project has any plans at all. When the README.todo
            // filter leaves zero visible items, this section is the only
            // thing keeping the project row expanded instead of collapsed.
            const projectPlans = store.getPlanItems();
            if (projectPlans.length > 0) {
                const planChildren: ProjectTodoItem[] = projectPlans.map((p) => {
                    const base = planInfoToTodoItem(p);
                    return {
                        line: base.line,
                        text: base.text,
                        description: base.description,
                        kind: base.kind,
                        checked: base.checked,
                        filePath: base.filePath,
                        parentSection: base.parentSection,
                        level: base.level,
                        projectName,
                        projectPath,
                    };
                });
                filtered.push(makePlansSection(planChildren));
            }

            // Decorate items with project information
            const decoratedChildren = decorateItems(filtered, projectName, projectPath);

            const projectItem: ProjectTodoItem = {
                line: -1,
                text: projectName,
                kind: "section",
                checked: false,
                children: decoratedChildren,
                projectName,
                projectPath,
            };
            projectItems.push(projectItem);
        }

        // Sort groups by the folder name where README.todo was found.
        // Same-name folders use their absolute path as a deterministic tie-breaker.
        projectItems.sort(
            (a, b) =>
                a.text.localeCompare(b.text) ||
                a.projectPath.localeCompare(b.projectPath),
        );

        return projectItems;
    }

    /**
     * 建構 top-level "Current Workspace" wrapper section + 其下的
     * sub-project rows。每個 sub-project 走與 `~/projects` project
     * row 相同的 filter + Plans 邏輯,但 `line === -2` + 文字用
     * 相對路徑(讓巢狀結構一眼可見)。
     *
     * 過濾規則與 `~/projects` 一覽一致:每個 sub-project 永遠顯示,
     * 即使 children 被 filter 清空 — 一覽的本意是「這份 README.todo
     * 是否存在」,而不是「當前 filter 下可看見的 task」。
     */
    private makeWorkspaceSection(
        workspaceStores: Map<string, import("../todo/todoStore").TodoStore>,
        emptyStateCopy?: string,
    ): ProjectTodoItem {
        const subProjects: ProjectTodoItem[] = [];

        for (const [projectPath, store] of workspaceStores) {
            const projectName = this.workspaceRoot
                ? path.relative(this.workspaceRoot, projectPath) || path.basename(projectPath)
                : path.basename(projectPath);
            const raw = store.getItems();

            const completedFiltered = this.showCompleted ? raw : filterCompleted(raw);
            const filtered = applyPriorityFilter(completedFiltered, this.enabledPriorities);

            // 附加 per-project Plans sub-section,語意對齊 `~/projects`
            // 一覽的同位置處理。
            const projectPlans = store.getPlanItems();
            if (projectPlans.length > 0) {
                const planChildren: ProjectTodoItem[] = projectPlans.map((p) => {
                    const base = planInfoToTodoItem(p);
                    return {
                        line: base.line,
                        text: base.text,
                        description: base.description,
                        kind: base.kind,
                        checked: base.checked,
                        filePath: base.filePath,
                        parentSection: base.parentSection,
                        level: base.level,
                        projectName,
                        projectPath,
                    };
                });
                filtered.push(makePlansSection(planChildren));
            }

            const decoratedChildren = decorateItems(filtered, projectName, projectPath);

            subProjects.push({
                line: -2, // 區隔於 ~/projects project row (-1)
                text: projectName,
                kind: "section",
                checked: false,
                children: decoratedChildren,
                projectName,
                projectPath,
            });
        }

        // 排序:相對路徑字串字典序,讓 src/ > tests/ 之類一眼可見。
        subProjects.sort((a, b) => a.text.localeCompare(b.text));

        // 空狀態 placeholder:當 workspace 內沒有任何 README.todo 時,
        // 推一個「導引訊息」子節點,讓使用者在 Expanded 預設下
        // 立刻看到「面板在這、需要做什麼」而不是看到一片空白。
        // 用 `kind: "list"` (free-form note) + `line: 0` 區隔於真實
        // project/section rows,rendering 時不會被誤判。
        // 注意 — 真實 sub-project 數量在加入 placeholder 之前快照,
        // 傳給 section item 的 description 用這個快照計算
        // `N sub-projects`,不要把 placeholder 算進去。
        //
        // 個別 panel 可透過 `emptyStateCopy` 覆寫 placeholder 文字
        // (SuperSet TODO panel 用「drop into a folder」措辭對齊
        // depth-1 contract,Workspace TODO 沿用舊文案)。
        const realSubProjectCount = subProjects.length;
        if (subProjects.length === 0) {
            subProjects.push({
                line: 0,
                text: "No README.todo files in this workspace",
                description:
                    emptyStateCopy ??
                    "Drop a README.todo into a subdirectory to add it here",
                kind: "list",
                checked: false,
                children: undefined,
                // empty projectPath — placeholder 不對應任何專案。
                projectName: "",
                projectPath: "",
            });
        }

        return {
            line: -3, // 與 project row / sub-project row 都區隔開
            text: "Workspace Todo (Current)",
            kind: "section",
            checked: false,
            children: subProjects,
            // empty projectPath — openProject 命令端會早返。
            projectName: "<workspace>",
            projectPath: "",
            // 把真實數量塞進 description field,讓 getTreeItem 用它
            // 算 `N sub-projects`,排除 placeholder。
            description: `${realSubProjectCount} sub-project${realSubProjectCount === 1 ? "" : "s"}`,
        };
    }

    /**
     * Flatten every workspace sub-project's actionable items into a
     * single flat list (sections and Plans wrappers dropped), apply
     * the active showCompleted + priority filters, then bucket by
     * leading `[Px]` tag. Mirrors `TodoTreeProvider.buildPriorityGroups`
     * but operates across multiple sub-stores — the SuperSet TODO
     * panel mounts this so its View: Priority button has the same
     * effect as the local TODO panel's.
     *
     * Plan items are passed through (no priority tag) and end up in
     * the `"None"` bucket, matching the local provider.
     */
    private buildWorkspacePriorityGroups(
        workspaceStores: Map<string, import("../todo/todoStore").TodoStore>,
    ): ProjectTodoItem[] {
        const flat: ProjectTodoItem[] = [];
        for (const [projectPath, store] of workspaceStores) {
            const projectName = this.workspaceRoot
                ? path.relative(this.workspaceRoot, projectPath) ||
                  path.basename(projectPath)
                : path.basename(projectPath);
            const raw = store.getItems();
            const completedFiltered = this.showCompleted
                ? raw
                : filterCompleted(raw);
            const filtered = applyPriorityFilter(
                completedFiltered,
                this.enabledPriorities,
            );
            // Plan items survive filterCompleted / applyPriorityFilter
            // (their passthrough behaviour mirrors the local panel),
            // but in priority view they belong in the "None" bucket.
            collectWorkspaceLeafItems(filtered, projectName, projectPath, flat);
        }

        const p0: ProjectTodoItem[] = [];
        const p1: ProjectTodoItem[] = [];
        const p2: ProjectTodoItem[] = [];
        const none: ProjectTodoItem[] = [];
        for (const item of flat) {
            const m = item.text.match(/^(\[|\()?(P[0-2])(\]|\))?/i);
            const tag = m?.[2]?.toUpperCase();
            const copy: ProjectTodoItem = { ...item, children: undefined };
            if (tag === "P0") p0.push(copy);
            else if (tag === "P1") p1.push(copy);
            else if (tag === "P2") p2.push(copy);
            else none.push(copy);
        }

        const groups: ProjectTodoItem[] = [];
        if (p0.length > 0) {
            groups.push({
                line: -100,
                text: "P0",
                kind: "section",
                checked: false,
                children: p0,
                projectName: "<workspace>",
                projectPath: "",
            });
        }
        if (p1.length > 0) {
            groups.push({
                line: -101,
                text: "P1",
                kind: "section",
                checked: false,
                children: p1,
                projectName: "<workspace>",
                projectPath: "",
            });
        }
        if (p2.length > 0) {
            groups.push({
                line: -102,
                text: "P2",
                kind: "section",
                checked: false,
                children: p2,
                projectName: "<workspace>",
                projectPath: "",
            });
        }
        if (none.length > 0) {
            groups.push({
                line: -103,
                text: "None",
                kind: "section",
                checked: false,
                children: none,
                projectName: "<workspace>",
                projectPath: "",
            });
        }
        return groups;
    }

    /**
     * Flatten every workspace sub-project's items, group by source
     * filename (via `extractLink` semantics), and return the grouped
     * tree. Mirrors `TodoTreeProvider.buildFileGroups`.
     *
     * Plan items are routed to a synthetic `"plans"` group via
     * `getWorkspaceFileGroup`'s kind-aware branch.
     */
    private buildWorkspaceFileGroups(
        workspaceStores: Map<string, import("../todo/todoStore").TodoStore>,
    ): ProjectTodoItem[] {
        const flat: ProjectTodoItem[] = [];
        for (const [projectPath, store] of workspaceStores) {
            const projectName = this.workspaceRoot
                ? path.relative(this.workspaceRoot, projectPath) ||
                  path.basename(projectPath)
                : path.basename(projectPath);
            const raw = store.getItems();
            const completedFiltered = this.showCompleted
                ? raw
                : filterCompleted(raw);
            const filtered = applyPriorityFilter(
                completedFiltered,
                this.enabledPriorities,
            );
            collectWorkspaceLeafItems(filtered, projectName, projectPath, flat);
        }

        const groupsMap = new Map<
            string,
            {
                label: string;
                description?: string;
                children: ProjectTodoItem[];
            }
        >();
        for (const item of flat) {
            const grp = getWorkspaceFileGroup(item.text, item.kind);
            const key = grp.label;
            const copy: ProjectTodoItem = { ...item, children: undefined };
            const existing = groupsMap.get(key) ?? {
                label: grp.label,
                description: grp.description,
                children: [],
            };
            existing.children.push(copy);
            groupsMap.set(key, existing);
        }

        const groups: ProjectTodoItem[] = [];
        let index = 0;
        for (const val of groupsMap.values()) {
            groups.push({
                line: -200 - index,
                text: val.label,
                description: val.description,
                kind: "section",
                checked: false,
                children: val.children,
                projectName: "<workspace>",
                projectPath: "",
            });
            index++;
        }

        groups.sort((a, b) => {
            if (a.text === "README.todo") return -1;
            if (b.text === "README.todo") return 1;
            if (a.text === "plans") return -1;
            if (b.text === "plans") return 1;
            return a.text.localeCompare(b.text);
        });
        return groups;
    }
}

function decorateItems(items: any[], projectName: string, projectPath: string): ProjectTodoItem[] {
    return items.map(item => {
        const decorated: ProjectTodoItem = {
            ...item,
            projectName,
            projectPath,
        };
        if (item.children) {
            decorated.children = decorateItems(item.children, projectName, projectPath);
        }
        return decorated;
    });
}

/**
 * Walk a sub-store's filtered items, dropping section wrappers and
 * collecting every leaf checkbox/list/plan item into `out`. Children
 * of leaf items are dropped (priority/file views show one row per
 * task, not the full sub-tree — matching `TodoTreeProvider`'s
 * behaviour). Recurses into section children because `filterCompleted`
 * / `applyPriorityFilter` return a top-level list where the leaves
 * are nested under their `##`/Default section wrapper.
 */
function collectWorkspaceLeafItems(
    items: import("../todo/types").TodoItem[],
    projectName: string,
    projectPath: string,
    out: ProjectTodoItem[],
): void {
    for (const item of items) {
        if (item.kind !== "section") {
            out.push({
                ...item,
                children: undefined,
                projectName,
                projectPath,
            });
            continue;
        }
        if (item.children && item.children.length > 0) {
            collectWorkspaceLeafItems(
                item.children,
                projectName,
                projectPath,
                out,
            );
        }
    }
}

/**
 * Decide which file-group bucket a leaf item belongs to. Mirrors
 * `TodoTreeProvider.getFileGroup`:
 * - plan items → synthetic "plans" group
 * - no extractable link → "README.todo"
 * - link not ending in `.todo` → "README.todo"
 * - `.todo` link → host-relative label (filename + path description)
 */
function getWorkspaceFileGroup(
    text: string,
    kind: ProjectTodoItem["kind"],
): { label: string; description?: string } {
    if (kind === "plan") {
        return { label: "plans", description: "plans/" };
    }
    const link = extractLink(text);
    if (!link) {
        return { label: "README.todo" };
    }
    let cleanLink = link.split("#")[0];
    if (!cleanLink.toLowerCase().endsWith(".todo")) {
        return { label: "README.todo" };
    }
    if (cleanLink.startsWith("file:///")) {
        const p = cleanLink.substring(8);
        return labelForWorkspaceFilePath(p);
    }
    return labelForWorkspaceFilePath(cleanLink);
}

function labelForWorkspaceFilePath(
    filePath: string,
): { label: string; description?: string } {
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
        try {
            const url = new URL(filePath);
            return { label: url.hostname, description: url.pathname };
        } catch {
            return { label: filePath };
        }
    }
    const normalized = filePath.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const label = parts[parts.length - 1] || filePath;
    const description = parts.length > 1 ? parts.slice(0, -1).join("/") : undefined;
    return { label, description };
}
