import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import { TodoStore } from "./todoStore";
import { TodoTreeProvider } from "./todoTreeProvider";
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
    //    factory. The factory is the canonical emitter; this panel
    //    only provides the wiring (store adapter, tree-provider
    //    adapter, plan actions, badge refresh).
    //
    //    The factory is registered AFTER the file watcher setup so
    //    the lightweight `vscode` mock used by
    //    `extensionActivate.test.ts` (which lacks `RelativePattern`)
    //    still throws *before* any commands register — preserving
    //    the "failed plugin registers nothing" contract the test
    //    asserts on.

    // Normalize a TodoEngineItem (the factory's wider-kind union
    // that includes `checkboxWithLink`, `listArchived`, etc.) to the
    // narrower TodoItem the store understands.
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
        addTodo: (_item, text, section) => store.addTodo(text, section),
        openTodoFile: async (_item) => {
            // The single-workspace panel always opens the local
            // README.todo; no project picker needed.
            const uri = vscode.Uri.file(
                `${ctx.workspaceFolder}/README.todo`
            );
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                if (doc.languageId !== "markdown") {
                    await vscode.languages.setTextDocumentLanguage(
                        doc,
                        "markdown"
                    );
                }
                await vscode.commands.executeCommand(
                    "markdown.showPreview",
                    uri
                );
            } catch (err) {
                vscode.window.showErrorMessage(
                    `Failed to open README.todo: ${err}`
                );
            }
        },
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
        toggleShowCompleted: () => provider.toggleShowCompleted(),
        isShowingCompleted: () => provider.isShowingCompleted(),
        isPriorityEnabled: (p) => provider.isPriorityEnabled(p),
        togglePriority: (p) => provider.togglePriorityFilter(p),
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
        refreshTree: () => refreshTodoFilterBadge(),
        workspaceFolder: ctx.workspaceFolder,
        getActiveItem: () => undefined,
        store: todoStoreAdapter,
        treeProvider: todoTreeAdapter,
        planActions: planActionAdapter,
        reportPlanActionError,
    } satisfies TodoCommandContext);

    // Drive the native checkbox click. The framework only fires this
    // when the checkbox icon (not the row text) is clicked. Each
    // entry is the (item, newState) pair the framework hands us.
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

    // Push initial priority-filter context keys. The factory's
    // `syncPriorityContext()` also pushes them whenever a FilterP*
    // command fires, so this initial call keeps the menu icons
    // consistent on activate.
    todoFactorySet.syncPriorityContext();

    ctx.subscriptions.push(
        view,
        visibilitySub,
        todoFileWatcher,
        plansWatcher,
        // All `superset.todo*` commands (Toggle / ChangePriority /
        // Filter{P0,P1,P2}{,On} / ViewSec/PX/File / FilterHideCompleted /
        // ShowAll / New / Open / OpenLink / Complete|Backlog|Archive|Delete
        // Plan / Copy / Archive / Rollback / ArchiveSection /
        // UnarchiveSection / ChangeSection / DeleteSection / Rename /
        // Delete) are emitted by the todoEngine factory. Each handler
        // delegates back to the same store / provider this panel uses;
        // the factory's disposables are added to the panel's pool so
        // deactivate tears them down.
        ...todoFactorySet.disposables,
        // TreeViewRegistry entry — disposed alongside the view so the
        // `superset.revealInTree` command can't walk a stale panel.
        treeViewEntry ?? { dispose: () => undefined },
        { dispose: () => provider.stop() }
    );

    return {
        dispose() {
            provider.stop();
            // Factory disposes its own registered commands via
            // `todoFactorySet.disposables` above.
            view.dispose();
            todoFileWatcher.dispose();
            plansWatcher.dispose();
        },
    };
}