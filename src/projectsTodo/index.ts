import * as vscode from "vscode";
import * as path from "path";
import type { FeatureContext, FeatureHandle } from "../shared";
import { ProjectsTodoStore } from "./projectsTodoStore";
import { ProjectsTodoTreeProvider } from "./projectsTodoTreeProvider";
import { computeTodoBadgeTitle } from "../todo/badge";
import {
    completePlan as completePlanFs,
    backlogPlan as backlogPlanFs,
    archivePlan as archivePlanFs,
    deletePlan as deletePlanFs,
} from "../todo/planActions";
import { formatPlanCopyText } from "../todo/plansSource";
import { getTreeViewRegistry } from "../plugin/treeViewRegistry";
import {
    createTodoCommands,
    reportPlanActionError,
    type TodoCommandContext,
    type TodoCommandStore,
    type TodoCommandTreeProvider,
    type TodoCommandPlanActions,
    type TodoEngineItem,
} from "../todoEngine";
import type { ProjectTodoItem } from "./types";

const PROJECTS_TODO_VIEW_TITLE = "Projects TODO";

export function register(ctx: FeatureContext): FeatureHandle {
    const store = new ProjectsTodoStore();
    const provider = new ProjectsTodoTreeProvider(
        store,
        ctx.workspaceFolder,
        ctx.context.extensionUri,
        "projects",
    );
    const workspaceProvider = new ProjectsTodoTreeProvider(
        store,
        ctx.workspaceFolder,
        ctx.context.extensionUri,
        "workspace",
    );
    provider.start();
    workspaceProvider.start();

    const workspaceView = vscode.window.createTreeView("superset.workspaceTodo", {
        treeDataProvider: workspaceProvider,
        showCollapseAll: true,
        manageCheckboxStateManually: true,
    });

    const view = vscode.window.createTreeView("superset.projectsTodo", {
        treeDataProvider: provider,
        showCollapseAll: true,
        manageCheckboxStateManually: true,
    });

    // Report active view for panel-layout persistence (plan §3).
    const visibilitySub = view.onDidChangeVisibility((visible) => {
        if (visible) {
            void vscode.commands.executeCommand(
                "superset.reportViewVisible",
                "superset.projectsTodo"
            );
        }
    });

    const workspaceVisibilitySub = workspaceView.onDidChangeVisibility((visible) => {
        if (visible) {
            void vscode.commands.executeCommand(
                "superset.reportViewVisible",
                "superset.workspaceTodo"
            );
        }
    });

    // Cross-panel reveal-in-tree wiring: a future TreeView click
    // e.g. from mDNS can focus a projectsTodo row via
    // `superset.revealInTree({ viewId: "superset.projectsTodo" })`.
    const workspaceTreeViewEntry = getTreeViewRegistry()?.register(
        "superset.workspaceTodo",
        workspaceView as unknown as vscode.TreeView<unknown>,
        workspaceProvider as unknown as vscode.TreeDataProvider<unknown>,
        ctx.shared.log
    );

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

    // ── Workspace scan (遞迴掃描當前 VSCode workspace 內的 README.todo)
    //
    // 讀取 `superset.projectsTodo.maxDepth` 設定(預設 5),把 workspace
    // 根目錄下符合條件的子目錄收成「Current Workspace」section。
    // 與 `~/projects` 一覽是兩條獨立 store map,互不污染。
    const configSection = "superset.projectsTodo";
    const readMaxDepth = (): number => {
        const v = vscode.workspace
            .getConfiguration(configSection)
            .get<number>("maxDepth", 5);
        // schema 雖標 minimum: 1 / maximum: 10,但 settings.json 不強制
        // 驗證;這層 clamp 確保繞過 schema 直接寫入的值仍落在 1-10。
        return Math.min(10, Math.max(1, v));
    };
    let maxDepth = readMaxDepth();

    const loadWorkspaceTodos = () =>
        store
            .loadWorkspaceTodos(ctx.workspaceFolder, maxDepth)
            .then(() => refreshProjectsTodoFilterBadge());

    loadWorkspaceTodos();

    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`${configSection}.maxDepth`)) {
            maxDepth = readMaxDepth();
            void loadWorkspaceTodos();
        }
    });

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

    // Watcher for plans/*.md under any README.todo-backed project.
    // Plan files do not create project rows; they only refresh the existing
    // per-project Plans subsection, so a full load preserves the README.todo
    // discovery gate while updating that subsection.
    const plansWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(projectsBaseDir, "**/plans/*.md")
    );
    const onPlansFileChanged = () => {
        store.load().then(() => refreshProjectsTodoFilterBadge());
    };
    plansWatcher.onDidChange(onPlansFileChanged);
    plansWatcher.onDidCreate(onPlansFileChanged);
    plansWatcher.onDidDelete(onPlansFileChanged);

    // ── Workspace-relative README.todo watcher
    //
    // 只負責 workspace 內部的 README.todo 變動;命中後只觸發
    // `loadWorkspaceTodos`,不會去碰 `~/projects` 一覽。兩條
    // watcher 路徑各自走各自的 store map,即使 workspace 落在
    // `~/projects` 底下(`~/projects/tmp/superset` 之類)也只會
    // 各掃各的,頂多重複觸發兩次 — 不會污染彼此的資料。
    const workspaceTodoWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(ctx.workspaceFolder, "**/README.todo")
    );
    const onWorkspaceTodoChanged = () => {
        void loadWorkspaceTodos();
    };
    workspaceTodoWatcher.onDidChange(onWorkspaceTodoChanged);
    workspaceTodoWatcher.onDidCreate(onWorkspaceTodoChanged);
    workspaceTodoWatcher.onDidDelete(onWorkspaceTodoChanged);

    // ── Emit the superset.projectsTodo* commands via the shared
    //    todoEngine factory. Placed AFTER the file-watcher setup
    //    so failure modes (e.g. lightweight `vscode` mock missing
    //    RelativePattern) still bail before any command registers.
    //    The store adapter here routes each item-level mutation
    //    through `store.getStore(item.projectPath)` because each
    //    project has its own sub-TodoStore. `addTodo` and
    //    `openTodoFile` additionally pick a project via QuickPick
    //    when invoked without row context.

    const getSubStore = (projectPath: string) =>
        store.getStore(projectPath) ?? store.getWorkspaceStore(projectPath);
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
        const sub = getSubStore(item.projectPath ?? "");
        if (!sub) return;
        // sub-store types are TodoStore; the factory calls into the
        // adapter shape, which matches TodoStore's mutation surface.
        const fn = (sub as unknown as Record<string, (...a: unknown[]) => unknown>)[kind];
        if (typeof fn === "function") await fn(item, ...rest);
    };

    // Pick a project path — prefer the row's `projectPath`, fall
    // back to a QuickPick when invoked without row context (e.g. the
    // top-level nav bar "+" button or `Open`).
    const pickProjectPath = async (
        item: TodoEngineItem | undefined,
        context: "new" | "open"
    ): Promise<string | undefined> => {
        if (item?.projectPath) return item.projectPath;
        const todoSet = new Set(store.getStores().keys());
        if (todoSet.size === 0) {
            if (context === "new") {
                vscode.window.showErrorMessage(
                    "無可用的專案項目 (No projects available)"
                );
            }
            return undefined;
        }
        const activeProjects = [...todoSet].map((p) => ({
            label: path.basename(p),
            description: p,
        }));
        const placeHolder =
            context === "new"
                ? "選擇專案以新增待辦事項 (Select project to add TODO)"
                : "選擇要開啟的 README.todo (Select README.todo to open)";
        const pick = await vscode.window.showQuickPick(activeProjects, {
            placeHolder,
        });
        return pick?.description;
    };

    const projectsStoreAdapter: TodoCommandStore = {
        toggle: (item) => dispatchItem("toggle", item),
        updatePriority: (item, p) =>
            dispatchItem("updatePriority", item, p),
        addTodo: async (item, text, section) => {
            const projectPath = await pickProjectPath(item, "new");
            if (!projectPath) return;
            const sub = getSubStore(projectPath);
            if (!sub) {
                vscode.window.showInformationMessage(
                    "此專案沒有 README.todo — 無法新增 todo"
                );
                return;
            }
            await sub.addTodo(text, section);
        },
        openTodoFile: async (item) => {
            let projectPath = item?.projectPath;
            if (!projectPath) {
                const todoSet = new Set(store.getStores().keys());
                if (todoSet.size === 0) {
                    // Fallback to workspace root when no projects
                    // have a README.todo yet.
                    projectPath = ctx.workspaceFolder;
                } else if (todoSet.size === 1) {
                    projectPath = [...todoSet][0]!;
                } else {
                    projectPath = await pickProjectPath(item, "open");
                    if (!projectPath) return;
                }
            }
            const uri = vscode.Uri.file(
                `${projectPath}/README.todo`
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
            await store.load();
        },
    };
    const projectsTreeAdapter: TodoCommandTreeProvider = {
        toggleShowCompleted: () => provider.toggleShowCompleted(),
        isShowingCompleted: () => provider.isShowingCompleted(),
        isPriorityEnabled: (p) => provider.isPriorityEnabled(p),
        togglePriority: (p) => provider.togglePriorityFilter(p),
        // projectsTodo panel only supports section / priority views;
        // the factory's ViewFile command is a no-op for this panel.
        setViewType: (t: "section" | "priority" | "file") => {
            (provider as unknown as {
                setViewType?: (t: "section" | "priority" | "file") => void;
            }).setViewType?.(t);
        },
        getViewType: () =>
            (provider as unknown as {
                getViewType?: () => "section" | "priority" | "file";
            }).getViewType?.() ?? "section",
        getSectionList: () => ["Default"],
    };
    const projectsPlanAdapter: TodoCommandPlanActions = {
        complete: (root, name) => completePlanFs(root, name),
        backlog: (root, name) => backlogPlanFs(root, name),
        archive: (root, name) => archivePlanFs(root, name),
        delete: (root, name) => deletePlanFs(root, name),
    };
    const projectsFactorySet = createTodoCommands({
        prefix: "projectsTodo",
        log: ctx.shared.log,
        showInfo: (m) => vscode.window.showInformationMessage(m),
        showError: (m) => vscode.window.showErrorMessage(m),
        refreshTree: () => refreshProjectsTodoFilterBadge(),
        workspaceFolder: ctx.workspaceFolder,
        getActiveItem: () => undefined,
        store: projectsStoreAdapter,
        treeProvider: projectsTreeAdapter,
        planActions: projectsPlanAdapter,
        reportPlanActionError,
    } satisfies TodoCommandContext);

    // Drive the native checkbox click.
    //   - `kind: "checkbox"`: toggle via the per-project sub-store.
    //   - `kind: "plan"`: route through `superset.projectsTodoCompletePlan`,
    //     which moves the file to `docs/specs/` and triggers a full
    //     store reload. The plan row disappears (the moved file is
    //     no longer in `plans/`), so the checkbox is never seen in
    //     a "checked" state.
    const handleCheckboxChange = async (e: { items: readonly [unknown, unknown][] }) => {
        for (const [item] of e.items) {
            const pItem = item as ProjectTodoItem;
            if (pItem.kind === "checkbox") {
                const subStore = store.getStore(pItem.projectPath) ??
                    store.getWorkspaceStore(pItem.projectPath);
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
    };
    view.onDidChangeCheckboxState?.(handleCheckboxChange);
    workspaceView.onDidChangeCheckboxState?.(handleCheckboxChange);

    // Open the project folder for a `kind: "project"` row (or any
    // row that carries a `projectPath`). Wired to the inline
    // `$(folder-opened)` icon in `package.json` for both
    // `viewItem == projectsTodoProject` and `viewItem == projectsTodoPlan`.
    const openProjectCmd = vscode.commands.registerCommand(
        "superset.openProject",
        async (item?: ProjectTodoItem) => {
            const projectPath = item?.projectPath;
            // Top-level "Plans" row uses "" as a placeholder — never
            // open an empty path (would resolve to the current
            // process cwd).
            if (!projectPath) return;
            const uri = vscode.Uri.file(projectPath);
            await vscode.commands.executeCommand("vscode.openFolder", uri, {
                forceNewWindow: true,
            });
        }
    );

    // Push initial priority-filter context keys. The factory's
    // `syncPriorityContext()` also pushes them whenever a FilterP*
    // command fires.
    projectsFactorySet.syncPriorityContext();

    ctx.subscriptions.push(
        openProjectCmd,
        workspaceView,
        view,
        workspaceVisibilitySub,
        visibilitySub,
        projectsWatcher,
        plansWatcher,
        workspaceTodoWatcher,
        configSub,
        // All `superset.projectsTodo*` commands are emitted by the
        // todoEngine factory. Each handler delegates back to the
        // per-project sub-store; the factory's disposables are added
        // to the panel's pool so deactivate tears them down.
        ...projectsFactorySet.disposables,
        // TreeViewRegistry entries — see TODO/mDNS wiring notes.
        workspaceTreeViewEntry ?? { dispose: () => undefined },
        treeViewEntry ?? { dispose: () => undefined },
        { dispose: () => provider.stop() },
        { dispose: () => workspaceProvider.stop() }
    );

    return {
        dispose() {
            provider.stop();
            workspaceProvider.stop();
            openProjectCmd.dispose();
            // Factory disposes its own registered commands via
            // `projectsFactorySet.disposables` above.
            workspaceView.dispose();
            view.dispose();
            projectsWatcher.dispose();
            plansWatcher.dispose();
            workspaceTodoWatcher.dispose();
            configSub.dispose();
        },
    };
}
