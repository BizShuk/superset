import * as vscode from "vscode";
import * as path from "path";
import type { FeatureContext, FeatureHandle } from "../shared";
import { WorkspaceTodoStore } from "./workspaceTodoStore";
import { WorkspaceTodoTreeProvider } from "./workspaceTodoTreeProvider";
import { invokeTodoStoreMutation } from "./storeDispatch";
import { computeTodoBadgeTitle } from "./badge";
import {
    completePlan as completePlanFs,
    backlogPlan as backlogPlanFs,
    archivePlan as archivePlanFs,
    deletePlan as deletePlanFs,
} from "./planActions";
import { formatPlanCopyText } from "./plansSource";
import type { TodoItem, WorkspaceTodoItem } from "./types";
import { getTreeViewRegistry } from "../plugin/treeViewRegistry";
import { registerViewVisibility } from "../plugin/viewVisibility";
import {
    createTodoCommands,
    reportPlanActionError,
    type TodoCommandContext,
    type TodoCommandStore,
    type TodoCommandTreeProvider,
    type TodoCommandPlanActions,
    type TodoEngineItem,
} from "../todoEngine";

const TODO_VIEW_TITLE = "TODO";
// TODO 面板的空狀態文案 — scan 邊界是 maxDepth + includeRoot=true,
// 所以措辭用「workspace subdirs」,不提「immediate」之類 depth-1 語意。
const SUPER_SET_EMPTY_COPY =
    "No README.todo files in this workspace — drop a README.todo into a subdirectory to add it here.";

/**
 * SuperSet TODO panel — 取代原本的「讀 workspace root README.todo」
 * 單檔行為,改用 workspace 內部掃描:
 *
 * - 從當前 workspace 根目錄出發,依 `superset.todo.maxDepth`
 *   設定(預設 5,範圍 1–10)遞迴,includeRoot = true(workspace
 *   root 自身也收)。設定變更時自動重新掃描。
 * - 每個含 `README.todo` 的子目錄作為一個 project row,內含
 *   sections + Plans。
 * - 保留 `src/todo/` 既有的所有 title buttons:View: Section /
 *   Priority / File、New TODO、Filter P0/P1/P2、Hide Completed /
 *   Show All、Open README.todo — 共 29 個 `superset.todo*` 命令。
 * - row context menu 與 inline action 都綁在 `todo*` context values
 *   上,由同一組 `superset.todo*` 命令服務。
 */
export function register(ctx: FeatureContext): FeatureHandle {
    const store = new WorkspaceTodoStore();
    const provider = new WorkspaceTodoTreeProvider(
        store,
        ctx.workspaceFolder,
        ctx.context.extensionUri,
        SUPER_SET_EMPTY_COPY,
    );
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
    const visibilitySub = registerViewVisibility(view, "superset.todo");

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
        if (!filtering) {
            updateTodoFilterBadge(false, 0);
            return;
        }
        // depth-1 面板把「已隱藏」計成所有 workspaceStores 已完成
        // 項目的總和 — 對齊既有 local TODO `store.getCompletedCount()`
        // 行為。多 sub-project 不會 double-count 因為各 store 各自
        // 持有自己的 items 快照。
        let totalHidden = 0;
        for (const s of store.getWorkspaceStores().values()) {
            totalHidden += s.getCompletedCount();
        }
        updateTodoFilterBadge(true, totalHidden);
    };

    // Push initial state.
    refreshTodoFilterBadge();

    // Workspace scan:
    // - 讀取 `superset.todo.maxDepth` 設定(預設 5,範圍 1–10)
    // - `includeRoot = true`(workspace root 自身也收)
    // - 設定變更時自動重新掃描
    const configSection = "superset.todo";
    const readMaxDepth = (): number => {
        const v = vscode.workspace
            .getConfiguration(configSection)
            .get<number>("maxDepth", 5);
        return Math.min(10, Math.max(1, v));
    };
    let maxDepth = readMaxDepth();

    const loadWorkspaceTodos = () =>
        store
            .loadWorkspaceTodos(ctx.workspaceFolder, maxDepth, true)
            .then(() => refreshTodoFilterBadge());

    loadWorkspaceTodos();

    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`${configSection}.maxDepth`)) {
            maxDepth = readMaxDepth();
            void loadWorkspaceTodos();
        }
    });

    ctx.resetHandlers.push(async () => {
        await store.reset();
        refreshTodoFilterBadge();
    });

    // Watch every `README.todo` under the workspace root recursively so
    // any new file at any depth re-triggers the scan. The depth is
    // applied inside `loadWorkspaceTodos(folder, maxDepth, true)` —
    // the watcher just nudges the scan.
    const workspaceTodoWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(ctx.workspaceFolder, "**/README.todo")
    );
    const onWorkspaceTodoChanged = () => {
        void loadWorkspaceTodos();
    };
    workspaceTodoWatcher.onDidChange(onWorkspaceTodoChanged);
    workspaceTodoWatcher.onDidCreate(onWorkspaceTodoChanged);
    workspaceTodoWatcher.onDidDelete(onWorkspaceTodoChanged);

    // Watch every sub-project's `plans/*.md` so newly authored plan
    // files appear in the panel without needing to reload the window.
    const plansWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(ctx.workspaceFolder, "**/plans/*.md")
    );
    const onPlansFileChanged = () => {
        store.reset().then(() => {
            void loadWorkspaceTodos();
        });
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
    // narrower TodoItem the sub-store understands.
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

    const getSubStore = (projectPath: string | undefined) => {
        if (!projectPath) return undefined;
        return store.getWorkspaceStore(projectPath);
    };

    // dispatchItem routes a per-row mutation through the owning
    // sub-store. Scope is the workspace store map only.
    const dispatchItem = async (
        kind:
            | "toggle"
            | "updatePriority"
            | "archiveTodo"
            | "rollbackTodo"
            | "moveTodo"
            | "deleteTodo"
            | "updateText"
            | "archiveSection"
            | "unarchiveSection"
            | "deleteSection",
        item: TodoEngineItem,
        ...rest: unknown[]
    ): Promise<void> => {
        const sub = getSubStore(item.projectPath);
        if (!sub) return;
        // `TodoStore` methods read instance state (`this.repository`);
        // dispatch through the shared helper so the receiver survives.
        await invokeTodoStoreMutation(sub, kind, item, ...rest);
    };

    // Pick a sub-project path — prefer the row's `projectPath`,
    // otherwise surface a QuickPick of the discovered workspace
    // sub-directories that have a `README.todo` file. Empty workspace
    // → info message.
    const pickSubProjectPath = async (
        context: "new" | "open",
    ): Promise<string | undefined> => {
        const todoSet = new Set(store.getWorkspaceStores().keys());
        if (todoSet.size === 0) {
            vscode.window.showInformationMessage(
                context === "new"
                    ? "No README.todo in any subdirectory — drop one into a folder to add a TODO."
                    : "No README.todo in any subdirectory to open."
            );
            return undefined;
        }
        const activeProjects = [...todoSet]
            .sort()
            .map((p) => ({
                label: path.relative(ctx.workspaceFolder, p) || path.basename(p),
                description: p,
            }));
        const placeHolder =
            context === "new"
                ? "Select a subdirectory to add a TODO"
                : "Select a README.todo to open";
        const pick = await vscode.window.showQuickPick(activeProjects, {
            placeHolder,
        });
        return pick?.description;
    };

    const todoStoreAdapter: TodoCommandStore = {
        toggle: (item) => dispatchItem("toggle", item),
        updatePriority: (item, p) =>
            dispatchItem("updatePriority", item, p),
        addTodo: async (item, text, section) => {
            let projectPath = item?.projectPath;
            if (!projectPath) {
                projectPath = await pickSubProjectPath("new");
                if (!projectPath) return;
            }
            const sub = getSubStore(projectPath);
            if (!sub) return;
            await sub.addTodo(text, section);
        },
        openTodoFile: async (item) => {
            let projectPath = item?.projectPath;
            if (!projectPath) {
                const todoSet = new Set(store.getWorkspaceStores().keys());
                if (todoSet.size === 0) {
                    vscode.window.showInformationMessage(
                        "No README.todo in any subdirectory — drop one into a folder to open."
                    );
                    return;
                }
                if (todoSet.size === 1) {
                    projectPath = [...todoSet][0]!;
                } else {
                    projectPath = await pickSubProjectPath("open");
                    if (!projectPath) return;
                }
            }
            const uri = vscode.Uri.file(`${projectPath}/README.todo`);
            try {
                const doc = await vscode.window.showTextDocument(uri, {
                    preview: true,
                });
                void doc; // keep linter quiet; preview is side-effect.
            } catch (err) {
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
                } catch (innerErr) {
                    vscode.window.showErrorMessage(
                        `Failed to open README.todo: ${innerErr ?? err}`
                    );
                }
            }
        },
        moveTodo: (item, section) => dispatchItem("moveTodo", item, section),
        archiveTodo: (item) => dispatchItem("archiveTodo", item),
        rollbackTodo: (item) => dispatchItem("rollbackTodo", item),
        archiveSection: (item) => dispatchItem("archiveSection", item),
        unarchiveSection: (item) => dispatchItem("unarchiveSection", item),
        deleteSection: (item) => dispatchItem("deleteSection", item),
        updateText: (line, text) =>
            dispatchItem("updateText", {
                line,
                text,
                checked: false,
                kind: "checkbox",
            } as TodoEngineItem),
        deleteTodo: (item) => dispatchItem("deleteTodo", item),
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
        // Section names the user can move an item into. When the row
        // carries a `projectPath`, look up the owning sub-store and
        // enumerate its `##`/`###` headings; otherwise fall back to
        // `["Default"]` so the QuickPick has at least one option.
        getSectionList: (item?: TodoEngineItem) => {
            const sub = item?.projectPath
                ? store.getWorkspaceStore(item.projectPath)
                : undefined;
            if (!sub) return ["Default"];
            const sections = new Set<string>(["Default"]);
            for (const it of sub.getItems()) {
                const level = (it as { level?: number }).level;
                if (level !== undefined && it.text) {
                    sections.add(it.text);
                }
            }
            return [...sections];
        },
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
    //     via the owning sub-store, which writes the file and emits
    //     the change that re-renders the tree with the new state.
    //   - `kind: "plan"`: route through `superset.todoCompletePlan`,
    //     which moves the file to `docs/specs/` and refreshes the
    //     store. The row disappears from the tree entirely, so the
    //     checkbox is never seen in a "checked" state.
    view.onDidChangeCheckboxState?.(async (e) => {
        for (const [item] of e.items) {
            const pItem = item as TodoEngineItem;
            if (pItem.kind === "checkbox") {
                const subStore = getSubStore(pItem.projectPath);
                if (subStore) {
                    await subStore.toggle(asTodoItem(pItem));
                }
            } else if (pItem.kind === "plan") {
                await vscode.commands.executeCommand(
                    "superset.todoCompletePlan",
                    pItem,
                );
            }
        }
    });

    // Open a sub-project folder in a new window. Wired to the inline
    // `$(folder-opened)` icon for `viewItem == todoProject` and
    // `viewItem == todoPlan` in `package.json`.
    const openProjectCmd = vscode.commands.registerCommand(
        "superset.openProject",
        async (item?: WorkspaceTodoItem) => {
            const projectPath = item?.projectPath;
            // Synthetic wrapper rows carry an empty `projectPath` —
            // never open one (it would resolve to the process cwd).
            if (!projectPath) return;
            const uri = vscode.Uri.file(projectPath);
            await vscode.commands.executeCommand("vscode.openFolder", uri, {
                forceNewWindow: true,
            });
        }
    );

    // Push initial priority-filter context keys. The factory's
    // `syncPriorityContext()` also pushes them whenever a FilterP*
    // command fires, so this initial call keeps the menu icons
    // consistent on activate.
    todoFactorySet.syncPriorityContext();

    ctx.subscriptions.push(
        view,
        openProjectCmd,
        visibilitySub,
        workspaceTodoWatcher,
        plansWatcher,
        configSub,
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
            openProjectCmd.dispose();
            view.dispose();
            workspaceTodoWatcher.dispose();
            plansWatcher.dispose();
            configSub.dispose();
        },
    };
}
