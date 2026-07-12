import * as vscode from "vscode";
import * as path from "path";
import type { FeatureContext, FeatureHandle } from "../shared";
import { TodoStore } from "./todoStore";
import { TodoTreeProvider } from "./todoTreeProvider";
import { extractLink, resolveTodoLink } from "../todoEngine/linkUtils";
import { computeTodoBadgeTitle } from "./badge";
import {
    completePlan as completePlanFs,
    backlogPlan as backlogPlanFs,
    archivePlan as archivePlanFs,
    deletePlan as deletePlanFs,
} from "./planActions";
import { formatPlanCopyText } from "./plansSource";
import type { TodoItem } from "./types";
import { getTreeViewRegistry } from "../plugin/treeViewRegistry";
import {
    createTodoCommands,
    reportPlanActionError,
    type TodoCommandContext,
    type TodoCommandStore,
    type TodoCommandTreeProvider,
    type TodoCommandPlanActions,
} from "../todoEngine";

const TODO_VIEW_TITLE = "TODO";

export function register(ctx: FeatureContext): FeatureHandle {
    const store = new TodoStore(ctx.workspaceFolder);
    const provider = new TodoTreeProvider(store, ctx.context.extensionUri);
    provider.start();

    const view = vscode.window.createTreeView("superset.todo", {
        treeDataProvider: provider,
        showCollapseAll: true,
        // Manage checkbox state ourselves. With VSCode's default (auto)
        // management, rendering a checked parent above unchecked children
        // makes the framework propagate the parent's Checked state down to
        // every child and fire onDidChangeCheckboxState for them — which our
        // handler writes back as `[x]`. That surfaced as "saving README.todo
        // auto-completes the child items". Manual mode fires the event only
        // for the exact row the user clicks, so no cascade.
        manageCheckboxStateManually: true,
    });

    // Report active view for panel-layout persistence (plan §3).
    const visibilitySub = view.onDidChangeVisibility((visible) => {
        if (visible) {
            void vscode.commands.executeCommand(
                "superset.reportViewVisible",
                "superset.todo"
            );
        }
    });

    // Wire into the cross-panel TreeViewRegistry so the
    // `superset.revealInTree` command can walk this panel's tree.
    // The panel keeps its own dispose chain — the registry entry is
    // disposed alongside the treeView (see `disposables` below).
    const treeViewEntry = getTreeViewRegistry()?.register(
        "superset.todo",
        view as unknown as vscode.TreeView<unknown>,
        provider as unknown as vscode.TreeDataProvider<unknown>,
        ctx.shared.log
    );

    // Context key + TreeView title reflect current filter state.
    const updateTodoFilterBadge = (filtering: boolean, hidden: number) => {
        void vscode.commands.executeCommand(
            "setContext",
            "superset.todo.filtering",
            filtering
        );
        view.title = computeTodoBadgeTitle(TODO_VIEW_TITLE, filtering, hidden);
    };

    const refreshTodoFilterBadge = () => {
        const filtering = !provider.isShowingCompleted();
        const total = store.getCompletedCount();
        if (!filtering) {
            updateTodoFilterBadge(false, 0);
            return;
        }
        // Type widened from `"checkbox" | "list"` to `string` because
        // the synthetic "Plans" section (added in getChildren when the
        // workspace has plan files) has kind: "section". We only read
        // `.length` downstream so the looser type is safe.
        const all = provider.getChildren() as
            | { line: number; text: string; kind: string; checked: boolean; children?: unknown[] }[]
            | undefined;
        const shown = all?.length ?? 0;
        const totalTop = store.getItems().length + (store.getPlanItems().length > 0 ? 1 : 0);
        const hidden = Math.max(0, totalTop - shown);
        updateTodoFilterBadge(true, hidden);
    };

    // Push initial state.
    refreshTodoFilterBadge();

    // Load initial data; re-load on file changes.
    store.load();

    ctx.resetHandlers.push(async () => {
        await store.reset();
        refreshTodoFilterBadge();
    });

    const todoFileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(ctx.workspaceFolder, "README.todo")
    );
    const onTodoFileChanged = () => {
        store.load().then(() => refreshTodoFilterBadge());
    };
    todoFileWatcher.onDidChange(onTodoFileChanged);
    todoFileWatcher.onDidCreate(onTodoFileChanged);

    // Watch the workspace's plans/ folder so newly authored plan files
    // appear in the panel without needing to reload the window.
    // TodoStore.load() runs both the README.todo read and the
    // plans/ scan in parallel, so a single reload here is enough.
    const plansWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(ctx.workspaceFolder, "plans/*.md")
    );
    const onPlansFileChanged = () => {
        store.load().then(() => refreshTodoFilterBadge());
    };
    plansWatcher.onDidChange(onPlansFileChanged);
    plansWatcher.onDidCreate(onPlansFileChanged);
    plansWatcher.onDidDelete(onPlansFileChanged);

    // ── Emit the superset.todo* commands via the shared todoEngine
    //    factory. The factory is the canonical emitter once the
    //    local duplicates below are removed; today it coexists
    //    with them (last-registration-wins for the same id, so
    //    the local handlers still take precedence). Placed AFTER
    //    the file watcher setup so the lightweight `vscode` mock
    //    used by `extensionActivate.test.ts` (which lacks
    //    `RelativePattern`) still throws *before* any commands
    //    register — preserving the "failed plugin registers
    //    nothing" contract the test asserts on.
    // Normalize a TodoEngineItem (the factory's wider-kind union
    // that includes `checkboxWithLink`, `listArchived`, etc.) to the
    // narrower TodoItem the store understands. The factory's
    // command handlers only branch on the basic kind (checkbox /
    // list / section / plan), so we collapse the variants.
    const asTodoItem = (item: {
        line: number;
        checked: boolean;
        text: string;
        kind: string;
        level?: number;
        filePath?: string;
    }): TodoItem => {
        const kind = item.kind;
        const normalized: TodoItem["kind"] =
            kind === "list" ||
            kind === "listWithLink" ||
            kind === "listArchived" ||
            kind === "listWithLinkArchived"
                ? "list"
                : kind === "section" ||
                  kind === "sectionArchivable" ||
                  kind === "sectionArchived"
                ? "section"
                : kind === "plan"
                ? "plan"
                : "checkbox";
        return {
            line: item.line,
            text: item.text,
            checked: item.checked,
            kind: normalized,
            level: item.level,
            filePath: item.filePath,
        } as TodoItem;
    };

    const todoStoreAdapter: TodoCommandStore = {
        toggle: (item) => store.toggle(asTodoItem(item)),
        updatePriority: (item, p) => store.updatePriority(asTodoItem(item), p),
        addTodo: (text, section) => store.addTodo(text, section),
        moveTodo: (item, section) => store.moveTodo(asTodoItem(item), section),
        archiveTodo: (item) => store.archiveTodo(asTodoItem(item)),
        rollbackTodo: (item) => store.rollbackTodo(asTodoItem(item)),
        archiveSection: (item) => store.archiveSection(asTodoItem(item)),
        unarchiveSection: (item) => store.unarchiveSection(asTodoItem(item)),
        deleteSection: (item) => store.deleteSection(asTodoItem(item)),
        updateText: (line, text) => store.updateText(line, text),
        deleteTodo: (item) => store.deleteTodo(asTodoItem(item)),
        reset: async () => {
            await store.reset();
        },
    };
    const todoTreeAdapter: TodoCommandTreeProvider = {
        toggleShowCompleted: () => {
            provider.toggleShowCompleted();
        },
        isShowingCompleted: () => provider.isShowingCompleted(),
        isPriorityEnabled: (p) => provider.isPriorityEnabled(p),
        togglePriority: (p) => {
            provider.togglePriorityFilter(p);
        },
        setViewType: (t) => provider.setViewType(t),
        getViewType: () => provider.getViewType(),
        getSectionList: () => provider.getSectionList(),
    };
    const planActionAdapter: TodoCommandPlanActions = {
        complete: (root, name) => completePlanFs(root, name),
        backlog: (root, name) => backlogPlanFs(root, name),
        archive: (root, name) => archivePlanFs(root, name),
        delete: (root, name) => deletePlanFs(root, name),
    };
    const todoFactorySet = createTodoCommands({
        prefix: "todo",
        log: ctx.shared.log,
        showInfo: (m) => vscode.window.showInformationMessage(m),
        showError: (m) => vscode.window.showErrorMessage(m),
        refreshTree: () => {
            refreshTodoFilterBadge();
        },
        workspaceFolder: ctx.workspaceFolder,
        getActiveItem: () => undefined,
        store: todoStoreAdapter,
        treeProvider: todoTreeAdapter,
        planActions: planActionAdapter,
        reportPlanActionError,
    } satisfies TodoCommandContext);

    // ── toggleCmd removed: emitted by todoEngine factory ──

    // Drive the native checkbox click. The framework only fires this when
    // the checkbox icon (not the row text) is clicked. Each entry is the
    // (item, newState) pair the framework hands us.
    //
    // Two row kinds carry a checkbox:
    //   - `kind: "checkbox"` (regular todo): toggle the checked state
    //     via the store, which writes the file and emits the change
    //     that re-renders the tree with the new state.
    //   - `kind: "plan"`: route through `superset.todoCompletePlan`,
    //     which moves the file to `docs/specs/` and refreshes the
    //     store. The row disappears from the tree entirely, so the
    //     checkbox is never seen in a "checked" state.
    view.onDidChangeCheckboxState?.(async (e) => {
        for (const [item] of e.items) {
            if (item.kind === "checkbox") {
                await store.toggle(item);
            } else if (item.kind === "plan") {
                await vscode.commands.executeCommand(
                    "superset.todoCompletePlan",
                    item,
                );
            }
        }
    });

    // ── changePriorityCmd removed: emitted by todoEngine factory ──

    // Sync the active priority filter state into VS Code context keys so
    // the view-title buttons can swap icons (`$(filter-filled)` active vs
    // `$(filter)` inactive). Kept here for the `Refresh` initial
    // push — the per-command setContext is now wired into the
    // todoEngine factory's `applyFilterToggle` callback so the
    // factory-emitted FilterP0/P1/P2/FilterP0On/P1On/P2On commands
    // keep the context keys in sync.
    const syncPriorityContext = () => {
        void vscode.commands.executeCommand(
            "setContext",
            "superset.todo.filterP0",
            provider.isPriorityEnabled("P0")
        );
        void vscode.commands.executeCommand(
            "setContext",
            "superset.todo.filterP1",
            provider.isPriorityEnabled("P1")
        );
        void vscode.commands.executeCommand(
            "setContext",
            "superset.todo.filterP2",
            provider.isPriorityEnabled("P2")
        );
    };

    // Push initial context-key state.
    syncPriorityContext();

    const todoNewCmd = vscode.commands.registerCommand(
        "superset.todoNew",
        async (item?: TodoItem) => {
            // When invoked from the inline "+" next to a section row, VSCode
            // passes the section's TodoItem as the first arg — use its text
            // as the target section. From the top-level nav "+" (no arg),
            // or from a non-section context, fall back to "Default".
            const sectionName = item?.kind === "section" ? item.text : "Default";
            const text = await vscode.window.showInputBox({
                prompt: "新增待辦事項描述 (New TODO Description)",
                placeHolder: "輸入待辦事項內容...",
            });
            if (!text || text.trim() === "") return;

            await store.addTodo(text.trim(), sectionName);
        }
    );

    const openTodoFileCmd = vscode.commands.registerCommand(
        "superset.todoOpen",
        async () => {
            const uri = vscode.Uri.file(path.join(ctx.workspaceFolder, "README.todo"));
            try {
                // `README.todo` isn't a `.md` file, so VSCode won't treat it as
                // markdown by default — force the languageId so the built-in
                // markdown preview (and our todoPreview markdown-it hook +
                // previewStyles) apply. No `files.associations` setting needed.
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
     * `viewItem == todoCheckboxWithLink || todoListWithLink || ...`
     * row PLUS every `viewItem == todoPlan` row via the
     * `group: "inline"` menu entries in `package.json`. The plan case
     * was previously its own `superset.todoOpenPlan` command but was
     * unified here so the icon stays consistent and the menu wiring
     * stays minimal.
     */
    const openTodoLinkCmd = vscode.commands.registerCommand(
        "superset.todoOpenLink",
        async (item?: TodoItem) => {
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
                const resolved = resolveTodoLink(target, ctx.workspaceFolder);
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
     * Plan lifecycle actions — every command takes a `kind: "plan"`
     * row, derives the basename from `item.filePath`, calls the
     * matching pure helper from `./planActions`, then refreshes the
     * store so the moved/deleted file disappears from the tree.
     *
     *   completePlan → plans/<f> → docs/specs/<f>    (inline ✓ button)
     *   backlogPlan  → plans/<f> → docs/backlog/<f> (2_edit@1)
     *   archivePlan  → plans/<f> → plans/archive/<f> (2_edit@2)
     *   deletePlan   → plans/<f> → (gone)            (3_delete)
     *
     * `planActions` is pure (no vscode import) so its errors are
     * surfaced as `PlanActionError`; we map them to user-friendly
     * VSCode notifications here.
     */









    const changeSectionCmd = vscode.commands.registerCommand(
        "superset.todoChangeSection",
        async (item?: TodoItem) => {
            if (!item) return;
            if (item.kind === "plan") return;

            // 1. Get existing sections from memory
            const rawSections = store.getItems()
                .filter(i => i.kind === "section")
                .map(i => i.text);

            // Ensure "Default" is in the options and listed first.
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

            await store.moveTodo(item, targetSection);
        }
    );

    const deleteSectionCmd = vscode.commands.registerCommand(
        "superset.todoDeleteSection",
        async (item?: TodoItem) => {
            if (!item) return;
            // Synthetic "Plans" section is computed at render time —
            // it has no real heading line in `README.todo` so deleting
            // it would have nothing to act on. Guard here as a
            // belt-and-braces complement to the menu `when` clause.
            if (item.text === "Plans") return;
            if (provider.getViewType() !== "section") {
                vscode.window.showErrorMessage("Delete Section is only supported in Section View.");
                return;
            }
            const answer = await vscode.window.showWarningMessage(
                `確定要刪除區段「${item.text}」及其底下的所有待辦事項嗎？`,
                { modal: true },
                "確認刪除"
            );
            if (answer === "確認刪除") {
                await store.deleteSection(item);
            }
        }
    );


    const deleteTodoCmd = vscode.commands.registerCommand(
        "superset.todoDelete",
        async (item?: TodoItem) => {
            if (!item) return;
            if (item.kind !== "checkbox" && item.kind !== "list") return;

            const answer = await vscode.window.showWarningMessage(
                `確定要刪除待辦事項「${item.text}」嗎？`,
                { modal: true },
                "確認刪除"
            );
            if (answer === "確認刪除") {
                await store.deleteTodo(item);
            }
        }
    );

    // View-type + filter commands removed — emitted by the
    // todoEngine factory above. The factory's ViewSec/PX/File /
    // FilterHideCompleted/ShowAll / FilterP{0,1,2}{,On} handlers
    // delegate straight back to provider.setViewType and the
    // applyFilterToggle closure (which calls the panel's
    // refreshTodoFilterBadge).

    ctx.subscriptions.push(
        // (toggleCmd / changePriorityCmd removed — emitted by factory)
        todoNewCmd,
        openTodoFileCmd,
        openTodoLinkCmd,
        changeSectionCmd,
        deleteSectionCmd,
        deleteTodoCmd,
        // (viewSecCmd / viewPXCmd / viewFileCmd /
        //  hideCompletedCmd / showAllCmd / filterP0Cmd /
        //  filterP0OnCmd / filterP1Cmd / filterP1OnCmd /
        //  filterP2Cmd / filterP2OnCmd removed — emitted by factory)
        view,
        visibilitySub,
        todoFileWatcher,
        plansWatcher,
        // todoEngine factory-issued commands. Each handler delegates
        // back to the same store/provider this panel uses; once the
        // local registerCommand duplicates above are removed the
        // factory becomes the canonical emitter.
        ...todoFactorySet.disposables,
        // TreeViewRegistry entry — disposed alongside the view so the
        // `superset.revealInTree` command can't walk a stale panel.
        treeViewEntry ?? { dispose: () => undefined },
        { dispose: () => provider.stop() }
    );

    return {
        dispose() {
            provider.stop();
            // (toggleCmd / changePriorityCmd disposed by factory)
            todoNewCmd.dispose();
            openTodoFileCmd.dispose();
            openTodoLinkCmd.dispose();
            changeSectionCmd.dispose();
            deleteSectionCmd.dispose();
            deleteTodoCmd.dispose();
            // (viewSecCmd / viewPXCmd / viewFileCmd /
            //  hideCompletedCmd / showAllCmd / filterP0Cmd /
            //  filterP0OnCmd / filterP1Cmd / filterP1OnCmd /
            //  filterP2Cmd / filterP2OnCmd removed — factory disposes)
            view.dispose();
            todoFileWatcher.dispose();
            plansWatcher.dispose();
        },
    };
}

