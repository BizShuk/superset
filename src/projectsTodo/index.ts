import * as vscode from "vscode";
import * as path from "path";
import type { FeatureContext, FeatureHandle } from "../shared";
import { ProjectsTodoStore } from "./projectsTodoStore";
import { ProjectsTodoTreeProvider } from "./projectsTodoTreeProvider";
import { computeTodoBadgeTitle } from "../todo/badge";
import { extractLink, resolveTodoLink } from "../todo/todoTreeProvider";
import {
    completePlan as completePlanFs,
    backlogPlan as backlogPlanFs,
    archivePlan as archivePlanFs,
    deletePlan as deletePlanFs,
    PlanActionError,
} from "../todo/planActions";
import { formatPlanCopyText } from "../todo/plansSource";
import { getTreeViewRegistry } from "../plugin/treeViewRegistry";
import type { ProjectTodoItem } from "./types";

const PROJECTS_TODO_VIEW_TITLE = "Projects TODO";

/** Map a `PlanActionError` to a contextual user-visible message. */
function reportPlanActionError(
    action: "complete" | "backlog" | "archive" | "delete",
    basename: string,
    err: unknown,
): void {
    if (err instanceof PlanActionError) {
        const verb = action === "delete" ? "delete" : `move (${action})`;
        if (err.code === "exists") {
            vscode.window.showErrorMessage(
                `Cannot ${verb} "${basename}": a file already exists at the destination. Resolve manually and retry.`,
            );
        } else if (err.code === "missing") {
            vscode.window.showErrorMessage(
                `Cannot ${verb} "${basename}": source plan no longer exists (was it moved already?).`,
            );
        } else {
            vscode.window.showErrorMessage(`Failed to ${verb} "${basename}": ${err.message}`);
        }
    } else {
        vscode.window.showErrorMessage(`Failed to ${action} plan "${basename}": ${err}`);
    }
}

export function register(ctx: FeatureContext): FeatureHandle {
    const store = new ProjectsTodoStore();
    const provider = new ProjectsTodoTreeProvider(store, ctx.context.extensionUri);
    provider.start();

    const view = vscode.window.createTreeView("superset.projectsTodo", {
        treeDataProvider: provider,
        showCollapseAll: true,
        manageCheckboxStateManually: true,
    });

    // Cross-panel reveal-in-tree wiring: a future TreeView click
    // e.g. from mDNS can focus a projectsTodo row via
    // `superset.revealInTree({ viewId: "superset.projectsTodo" })`.
    const treeViewEntry = getTreeViewRegistry()?.register(
        "superset.projectsTodo",
        view as unknown as vscode.TreeView<unknown>,
        provider as unknown as vscode.TreeDataProvider<unknown>,
        ctx.shared.log
    );

    const updateProjectsTodoFilterBadge = (filtering: boolean, hidden: number) => {
        void vscode.commands.executeCommand(
            "setContext",
            "superset.projectsTodo.filtering",
            filtering
        );
        view.title = computeTodoBadgeTitle(PROJECTS_TODO_VIEW_TITLE, filtering, hidden);
    };

    const refreshProjectsTodoFilterBadge = () => {
        const filtering = !provider.isShowingCompleted();
        if (!filtering) {
            updateProjectsTodoFilterBadge(false, 0);
            return;
        }

        let totalHidden = 0;
        for (const s of store.getStores().values()) {
            totalHidden += s.getCompletedCount();
        }
        updateProjectsTodoFilterBadge(true, totalHidden);
    };

    // Initial load
    store.load().then(() => refreshProjectsTodoFilterBadge());

    ctx.resetHandlers.push(async () => {
        await store.reset();
        refreshProjectsTodoFilterBadge();
    });

    // Watcher for all README.todo files under /Users/shuk/projects
    const home = require("os").homedir();
    const projectsBaseDir = path.join(home, "projects");

    // Relative pattern to watch any README.todo under projectsBaseDir recursively
    const projectsWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(projectsBaseDir, "**/README.todo")
    );

    const onTodoFileChanged = (uri: vscode.Uri) => {
        // Find which store owns this README.todo
        const filePath = uri.fsPath;
        const parentDir = path.dirname(filePath);
        const subStore = store.getStore(parentDir);
        if (subStore) {
            subStore.load().then(() => refreshProjectsTodoFilterBadge());
        } else {
            // New README.todo created or directory added, run a full scan
            store.load().then(() => refreshProjectsTodoFilterBadge());
        }
    };

    projectsWatcher.onDidChange(onTodoFileChanged);
    projectsWatcher.onDidCreate(onTodoFileChanged);
    projectsWatcher.onDidDelete((uri) => {
        // If a README.todo is deleted, reload projects to remove it
        store.load().then(() => refreshProjectsTodoFilterBadge());
    });

    // Watcher for plans/*.md under any project — plan files can be
    // authored or removed in projects that have *no* README.todo, so
    // we always run a full store.load() rather than trying to locate
    // the affected sub-store. PlansTodoStore.load() walks both maps.
    const plansWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(projectsBaseDir, "**/plans/*.md")
    );
    const onPlansFileChanged = () => {
        store.load().then(() => refreshProjectsTodoFilterBadge());
    };
    plansWatcher.onDidChange(onPlansFileChanged);
    plansWatcher.onDidCreate(onPlansFileChanged);
    plansWatcher.onDidDelete(onPlansFileChanged);

    // Drive the native checkbox click.
    //   - `kind: "checkbox"`: toggle via the per-project sub-store.
    //   - `kind: "plan"`: route through `superset.projectsTodoCompletePlan`,
    //     which moves the file to `docs/specs/` and triggers a full
    //     store reload. The plan row disappears (the moved file is
    //     no longer in `plans/`), so the checkbox is never seen in
    //     a "checked" state.
    view.onDidChangeCheckboxState?.(async (e) => {
        for (const [item] of e.items) {
            const pItem = item as ProjectTodoItem;
            if (pItem.kind === "checkbox") {
                const subStore = store.getStore(pItem.projectPath);
                if (subStore) {
                    await subStore.toggle(pItem);
                }
            } else if (pItem.kind === "plan") {
                await vscode.commands.executeCommand(
                    "superset.projectsTodoCompletePlan",
                    pItem,
                );
            }
        }
    });

    const openProjectCmd = vscode.commands.registerCommand(
        "superset.openProject",
        async (item?: ProjectTodoItem) => {
            const projectPath = item?.projectPath;
            // Top-level "Plans" row uses "" as a placeholder — never open
            // an empty path (would resolve to the current process cwd).
            if (!projectPath) return;
            const uri = vscode.Uri.file(projectPath);
            await vscode.commands.executeCommand("vscode.openFolder", uri, {
                forceNewWindow: true,
            });
        }
    );

    const toggleCmd = vscode.commands.registerCommand(
        "superset.projectsTodoToggle",
        async (item?: ProjectTodoItem) => {
            if (!item || item.kind === "list") return;
            if (item.kind === "plan") return;
            const subStore = store.getStore(item.projectPath);
            if (subStore) {
                await subStore.toggle(item);
            }
        }
    );

    const changePriorityCmd = vscode.commands.registerCommand(
        "superset.projectsTodoChangePriority",
        async (item?: ProjectTodoItem) => {
            if (!item || item.kind !== "checkbox") return;
            const subStore = store.getStore(item.projectPath);
            if (!subStore) return;

            const currentMatch = item.text.match(/^(\[|\()?(P[0-2])(\]|\))?/i);
            const currentPriority = currentMatch?.[2]?.toUpperCase() || "None";

            const pick = await vscode.window.showQuickPick(
                [
                    { label: "P0", description: "Highest priority" },
                    { label: "P1", description: "Medium priority" },
                    { label: "P2", description: "Low priority" },
                    { label: "None", description: "No priority" },
                ],
                {
                    placeHolder: `Current: ${currentPriority} — select new priority`,
                }
            );

            if (!pick) return;
            await subStore.updatePriority(item, pick.label as "P0" | "P1" | "P2" | "None");
        }
    );

    const todoNewCmd = vscode.commands.registerCommand(
        "superset.projectsTodoNew",
        async (item?: ProjectTodoItem) => {
            let projectPath = item?.projectPath;
            if (!projectPath) {
                const todoSet = new Set(store.getStores().keys());
                if (todoSet.size === 0) {
                    vscode.window.showErrorMessage("無可用的專案項目 (No projects available)");
                    return;
                }
                const activeProjects = [...todoSet].map((p) => ({
                    label: path.basename(p),
                    description: p,
                }));
                const pick = await vscode.window.showQuickPick(activeProjects, {
                    placeHolder: "選擇專案以新增待辦事項 (Select project to add TODO)"
                });
                if (!pick) return;
                projectPath = pick.description;
            }

            const subStore = store.getStore(projectPath);
            if (!subStore) {
                vscode.window.showInformationMessage("此專案沒有 README.todo — 無法新增 todo");
                return;
            }

            // When invoked from the inline "+" next to a section row,
            // VSCode passes the section's ProjectTodoItem — use its text
            // as the target section. From the project-row "+" or top-level
            // nav (no section context), fall back to "Default".
            const sectionName = item?.kind === "section" ? item.text : "Default";

            const text = await vscode.window.showInputBox({
                prompt: "新增待辦事項描述 (New TODO Description)",
                placeHolder: "輸入待辦事項內容...",
            });
            if (!text || text.trim() === "") return;

            await subStore.addTodo(text.trim(), sectionName);
        }
    );

    const openTodoFileCmd = vscode.commands.registerCommand(
        "superset.projectsTodoOpen",
        async (item?: ProjectTodoItem) => {
            let projectPath = item?.projectPath;
            if (!projectPath) {
                const todoSet = new Set(store.getStores().keys());
                if (todoSet.size === 0) {
                    // Fallback to workspace root
                    projectPath = ctx.workspaceFolder;
                } else if (todoSet.size === 1) {
                    projectPath = [...todoSet][0]!;
                } else {
                    const activeProjects = [...todoSet].map((p) => ({
                        label: path.basename(p),
                        description: p,
                    }));
                    const pick = await vscode.window.showQuickPick(activeProjects, {
                        placeHolder: "選擇要開啟的 README.todo (Select README.todo to open)"
                    });
                    if (!pick) return;
                    projectPath = pick.description;
                }
            }

            const uri = vscode.Uri.file(path.join(projectPath, "README.todo"));
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                if (doc.languageId !== "markdown") {
                    await vscode.languages.setTextDocumentLanguage(doc, "markdown");
                }
                await vscode.commands.executeCommand("markdown.showPreview", uri);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open README.todo: ${err}`);
            }
        }
    );

    /**
     * Open the target of a `kind: "checkbox/list"` row that carries
     * a `[text](url)` link in its label, OR open a `kind: "plan"` row's
     * backing `.md` file in the markdown preview.
     *
     * Wired to the inline `$(link-external)` icon button on every
     * `viewItem == projectsTodoCheckboxWithLink || ...` row PLUS every
     * `viewItem == projectsTodoPlan` row via the `group: "inline"` menu
     * entries in `package.json`. The plan case was previously its own
     * `superset.projectsTodoOpenPlan` command but was unified here so
     * the icon stays consistent and the menu wiring stays minimal.
     */
    const openTodoLinkCmd = vscode.commands.registerCommand(
        "superset.projectsTodoOpenLink",
        async (item?: ProjectTodoItem) => {
            if (!item) return;

            // Plan rows: open the backing `.md` file directly via
            // markdown preview. `item.text` is the H1 title (no link
            // syntax), so we must short-circuit BEFORE extractLink().
            if (item.kind === "plan") {
                if (!item.filePath) return;
                const uri = vscode.Uri.file(item.filePath);
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    if (doc.languageId !== "markdown") {
                        await vscode.languages.setTextDocumentLanguage(doc, "markdown");
                    }
                    await vscode.commands.executeCommand("markdown.showPreview", uri);
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to open plan: ${err}`);
                }
                return;
            }

            const target = extractLink(item.text);
            if (!target) return;

            try {
                const resolved = resolveTodoLink(target, item.projectPath);
                const uri = resolved.type === "url"
                    ? vscode.Uri.parse(resolved.uriOrPath)
                    : vscode.Uri.file(resolved.uriOrPath);

                const isMarkdown = uri.scheme === "file" && (
                    uri.path.toLowerCase().endsWith(".md") ||
                    uri.path.toLowerCase().endsWith(".markdown")
                );

                if (isMarkdown) {
                    await vscode.commands.executeCommand("markdown.showPreview", uri);
                } else {
                    await vscode.commands.executeCommand("vscode.open", uri);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open link: ${err}`);
            }
        }
    );

    /**
     * Plan lifecycle actions for the projects overview. Same four
     * transitions as `src/todo/index.ts` (complete → docs/specs/,
     * backlog → docs/backlog/, archive → plans/archive/, delete).
     * The workspace root is `item.projectPath` rather than the
     * single-workspace root used by the local TODO panel; the
     * overview can show plans from many projects so each row's
     * action must target its own project's filesystem.
     *
     * After a successful move/delete we re-load the affected sub-
     * store (not the whole overview) — the sub-store re-emits
     * `loaded`, which ProjectsTodoStore re-emits to the tree
     * provider, which then refreshes the row out of view.
     */
    const completePlanCmd = vscode.commands.registerCommand(
        "superset.projectsTodoCompletePlan",
        async (item?: ProjectTodoItem) => {
            if (!item?.filePath || !item.projectPath) return;
            const basename = path.basename(item.filePath);
            try {
                await completePlanFs(item.projectPath, basename);
                await store.getStore(item.projectPath)?.reset();
                vscode.window.showInformationMessage(
                    `Plan moved to docs/specs/: ${basename}`,
                );
            } catch (err) {
                reportPlanActionError("complete", basename, err);
            }
        }
    );

    const backlogPlanCmd = vscode.commands.registerCommand(
        "superset.projectsTodoBacklogPlan",
        async (item?: ProjectTodoItem) => {
            if (!item?.filePath || !item.projectPath) return;
            const basename = path.basename(item.filePath);
            try {
                await backlogPlanFs(item.projectPath, basename);
                await store.getStore(item.projectPath)?.reset();
                vscode.window.showInformationMessage(
                    `Plan moved to docs/backlog/: ${basename}`,
                );
            } catch (err) {
                reportPlanActionError("backlog", basename, err);
            }
        }
    );

    const archivePlanCmd = vscode.commands.registerCommand(
        "superset.projectsTodoArchivePlan",
        async (item?: ProjectTodoItem) => {
            if (!item?.filePath || !item.projectPath) return;
            const basename = path.basename(item.filePath);
            try {
                await archivePlanFs(item.projectPath, basename);
                await store.getStore(item.projectPath)?.reset();
                vscode.window.showInformationMessage(
                    `Plan moved to plans/archive/: ${basename}`,
                );
            } catch (err) {
                reportPlanActionError("archive", basename, err);
            }
        }
    );

    const deletePlanCmd = vscode.commands.registerCommand(
        "superset.projectsTodoDeletePlan",
        async (item?: ProjectTodoItem) => {
            if (!item?.filePath || !item.projectPath) return;
            const basename = path.basename(item.filePath);
            try {
                await deletePlanFs(item.projectPath, basename);
                await store.getStore(item.projectPath)?.reset();
                vscode.window.showInformationMessage(`Plan deleted: ${basename}`);
            } catch (err) {
                reportPlanActionError("delete", basename, err);
            }
        }
    );

    const copyTodoCmd = vscode.commands.registerCommand(
        "superset.projectsTodoCopy",
        async (item?: ProjectTodoItem) => {
            if (!item || !item.text) return;
            try {
                // Plan rows: copy `[title](file://...)` so the user
                // can paste a clickable Markdown link into another
                // doc. Plain text fallback otherwise.
                const planCopy = formatPlanCopyText(item);
                const payload = planCopy ?? item.text;
                await vscode.env.clipboard.writeText(payload);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to copy: ${err}`);
            }
        }
    );

    const archiveTodoCmd = vscode.commands.registerCommand(
        "superset.projectsTodoArchive",
        async (item?: ProjectTodoItem) => {
            if (!item) return;
            if (item.kind === "plan") return;
            const subStore = store.getStore(item.projectPath);
            if (subStore) {
                await subStore.archiveTodo(item);
            }
        }
    );

    const rollbackTodoCmd = vscode.commands.registerCommand(
        "superset.projectsTodoRollback",
        async (item?: ProjectTodoItem) => {
            if (!item) return;
            if (item.kind === "plan") return;
            const subStore = store.getStore(item.projectPath);
            if (subStore) {
                await subStore.rollbackTodo(item);
            }
        }
    );

    const archiveSectionCmd = vscode.commands.registerCommand(
        "superset.projectsTodoArchiveSection",
        async (item?: ProjectTodoItem) => {
            if (!item) return;
            if (item.text === "Plans") return;
            const subStore = store.getStore(item.projectPath);
            if (subStore) {
                await subStore.archiveSection(item);
            }
        }
    );

    const unarchiveSectionCmd = vscode.commands.registerCommand(
        "superset.projectsTodoUnarchiveSection",
        async (item?: ProjectTodoItem) => {
            if (!item) return;
            if (item.text === "Plans") return;
            const subStore = store.getStore(item.projectPath);
            if (subStore) {
                await subStore.unarchiveSection(item);
            }
        }
    );

    const changeSectionCmd = vscode.commands.registerCommand(
        "superset.projectsTodoChangeSection",
        async (item?: ProjectTodoItem) => {
            if (!item) return;
            if (item.kind === "plan") return;
            const subStore = store.getStore(item.projectPath);
            if (!subStore) return;

            const rawSections = subStore.getItems()
                .filter(i => i.kind === "section")
                .map(i => i.text);

            const sections = rawSections.includes("Default")
                ? ["Default", ...rawSections.filter(s => s !== "Default")]
                : ["Default", ...rawSections];

            const pickOptions = [
                ...sections.map(s => ({
                    label: s,
                    description: s === "Default" ? "預設區段 (No heading)" : `區段: ${s}`
                })),
                {
                    label: "$(plus) Create new section...",
                    description: "建立並移往新區段"
                }
            ];

            const pick = await vscode.window.showQuickPick(pickOptions, {
                placeHolder: "選擇要移往的區段 (Select target section)",
            });

            if (!pick) return;

            let targetSection = pick.label;
            if (pick.label === "$(plus) Create new section...") {
                const newSectionName = await vscode.window.showInputBox({
                    prompt: "輸入新區段名稱 (New Section Name)",
                    placeHolder: "例如: In Progress, Pending...",
                });
                if (!newSectionName || newSectionName.trim() === "") return;
                targetSection = newSectionName.trim();
            }

            await subStore.moveTodo(item, targetSection);
        }
    );

    const deleteSectionCmd = vscode.commands.registerCommand(
        "superset.projectsTodoDeleteSection",
        async (item?: ProjectTodoItem) => {
            if (!item) return;
            // Synthetic "Plans" section has no real heading line in
            // README.todo; deleting it would no-op anyway.
            if (item.text === "Plans") return;
            const subStore = store.getStore(item.projectPath);
            if (!subStore) return;

            const answer = await vscode.window.showWarningMessage(
                `確定要刪除區段「${item.text}」及其底下的所有待辦事項嗎？`,
                { modal: true },
                "確認刪除"
            );
            if (answer === "確認刪除") {
                await subStore.deleteSection(item);
            }
        }
    );

    const todoRenameCmd = vscode.commands.registerCommand(
        "superset.projectsTodoRename",
        async (item?: ProjectTodoItem) => {
            if (!item) return;
            if (item.kind !== "checkbox" && item.kind !== "list") return;
            const subStore = store.getStore(item.projectPath);
            if (!subStore) return;

            const newText = await vscode.window.showInputBox({
                prompt: "重新命名待辦事項 (Rename TODO Item)",
                value: item.text,
            });

            if (newText === undefined) return;
            const trimmed = newText.trim();
            if (trimmed === "" || trimmed === item.text) return;

            await subStore.updateText(item.line, trimmed);
        }
    );

    const deleteTodoCmd = vscode.commands.registerCommand(
        "superset.projectsTodoDelete",
        async (item?: ProjectTodoItem) => {
            if (!item) return;
            if (item.kind !== "checkbox" && item.kind !== "list") return;
            const subStore = store.getStore(item.projectPath);
            if (!subStore) return;

            const answer = await vscode.window.showWarningMessage(
                `確定要刪除待辦事項「${item.text}」嗎？`,
                { modal: true },
                "確認刪除"
            );
            if (answer === "確認刪除") {
                await subStore.deleteTodo(item);
            }
        }
    );

    const applyFilterToggle = () => {
        provider.toggleShowCompleted();
        refreshProjectsTodoFilterBadge();
    };

    const syncPriorityContext = () => {
        void vscode.commands.executeCommand(
            "setContext",
            "superset.projectsTodo.filterP0",
            provider.isPriorityEnabled("P0")
        );
        void vscode.commands.executeCommand(
            "setContext",
            "superset.projectsTodo.filterP1",
            provider.isPriorityEnabled("P1")
        );
        void vscode.commands.executeCommand(
            "setContext",
            "superset.projectsTodo.filterP2",
            provider.isPriorityEnabled("P2")
        );
    };

    const makePriorityToggleCmds = (p: "P0" | "P1" | "P2") => {
        const handler = () => {
            provider.togglePriorityFilter(p);
            syncPriorityContext();
            refreshProjectsTodoFilterBadge();
        };
        return [
            vscode.commands.registerCommand(`superset.projectsTodoFilter${p}`, handler),
            vscode.commands.registerCommand(`superset.projectsTodoFilter${p}On`, handler),
        ];
    };

    const [filterP0Cmd, filterP0OnCmd] = makePriorityToggleCmds("P0");
    const [filterP1Cmd, filterP1OnCmd] = makePriorityToggleCmds("P1");
    const [filterP2Cmd, filterP2OnCmd] = makePriorityToggleCmds("P2");

    syncPriorityContext();

    const hideCompletedCmd = vscode.commands.registerCommand(
        "superset.projectsTodoFilterHideCompleted",
        applyFilterToggle
    );

    const showAllCmd = vscode.commands.registerCommand(
        "superset.projectsTodoFilterShowAll",
        applyFilterToggle
    );

    ctx.subscriptions.push(
        openProjectCmd,
        toggleCmd,
        changePriorityCmd,
        todoNewCmd,
        openTodoFileCmd,
        openTodoLinkCmd,
        completePlanCmd,
        backlogPlanCmd,
        archivePlanCmd,
        deletePlanCmd,
        copyTodoCmd,
        archiveTodoCmd,
        rollbackTodoCmd,
        archiveSectionCmd,
        unarchiveSectionCmd,
        changeSectionCmd,
        deleteSectionCmd,
        todoRenameCmd,
        deleteTodoCmd,
        hideCompletedCmd,
        showAllCmd,
        filterP0Cmd,
        filterP0OnCmd,
        filterP1Cmd,
        filterP1OnCmd,
        filterP2Cmd,
        filterP2OnCmd,
        view,
        projectsWatcher,
        plansWatcher,
        // TreeViewRegistry entry — see TODO/mDNS wiring notes.
        treeViewEntry ?? { dispose: () => undefined },
        { dispose: () => provider.stop() }
    );

    return {
        dispose() {
            provider.stop();
            openProjectCmd.dispose();
            toggleCmd.dispose();
            changePriorityCmd.dispose();
            todoNewCmd.dispose();
            openTodoFileCmd.dispose();
            openTodoLinkCmd.dispose();
            completePlanCmd.dispose();
            backlogPlanCmd.dispose();
            archivePlanCmd.dispose();
            deletePlanCmd.dispose();
            copyTodoCmd.dispose();
            archiveTodoCmd.dispose();
            rollbackTodoCmd.dispose();
            archiveSectionCmd.dispose();
            unarchiveSectionCmd.dispose();
            changeSectionCmd.dispose();
            deleteSectionCmd.dispose();
            todoRenameCmd.dispose();
            deleteTodoCmd.dispose();
            hideCompletedCmd.dispose();
            showAllCmd.dispose();
            filterP0Cmd.dispose();
            filterP0OnCmd.dispose();
            filterP1Cmd.dispose();
            filterP1OnCmd.dispose();
            filterP2Cmd.dispose();
            filterP2OnCmd.dispose();
            view.dispose();
            projectsWatcher.dispose();
            plansWatcher.dispose();
        },
    };
}
