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
    const provider = new ProjectsTodoTreeProvider(store, ctx.context.extensionUri);
    provider.start();

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

    // ── Emit the superset.projectsTodo* commands via the shared
    //    todoEngine factory. Placed AFTER the file-watcher setup
    //    so failure modes (e.g. lightweight `vscode` mock missing
    //    RelativePattern) still bail before any command registers.
    //    The store adapter here routes each item-level mutation
    //    through `store.getStore(item.projectPath)` because each
    //    project has its own sub-TodoStore. `addTodo` and
    //    `openTodoFile` additionally pick a project via QuickPick
    //    when invoked without row context.

    const getSubStore = (projectPath: string) => store.getStore(projectPath);
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
        view,
        visibilitySub,
        projectsWatcher,
        plansWatcher,
        // All `superset.projectsTodo*` commands are emitted by the
        // todoEngine factory. Each handler delegates back to the
        // per-project sub-store; the factory's disposables are added
        // to the panel's pool so deactivate tears them down.
        ...projectsFactorySet.disposables,
        // TreeViewRegistry entry — see TODO/mDNS wiring notes.
        treeViewEntry ?? { dispose: () => undefined },
        { dispose: () => provider.stop() }
    );

    return {
        dispose() {
            provider.stop();
            openProjectCmd.dispose();
            // Factory disposes its own registered commands via
            // `projectsFactorySet.disposables` above.
            view.dispose();
            projectsWatcher.dispose();
            plansWatcher.dispose();
        },
    };
}