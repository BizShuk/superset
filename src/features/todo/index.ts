import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../../types";
import { TodoStore } from "../../todoStore";
import { TodoTreeProvider } from "../../todoTreeProvider";
import { computeTodoBadgeTitle } from "./badge";

const TODO_VIEW_TITLE = "TODO";

export function register(ctx: FeatureContext): FeatureHandle {
    const store = new TodoStore(ctx.workspaceFolder);
    const provider = new TodoTreeProvider(store, ctx.context.extensionUri);
    provider.start();

    const view = vscode.window.createTreeView("superset.todo", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

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
        const all = provider.getChildren() as
            | { line: number; text: string; kind: "checkbox" | "list"; checked: boolean; children?: unknown[] }[]
            | undefined;
        const shown = all?.length ?? 0;
        const totalTop = store.getItems().length;
        const hidden = Math.max(0, totalTop - shown);
        updateTodoFilterBadge(true, hidden);
    };

    // Push initial state.
    refreshTodoFilterBadge();

    // Load initial data; re-load on file changes.
    store.load();

    const todoFileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(ctx.workspaceFolder, "README.todo")
    );
    const onTodoFileChanged = () => {
        store.load().then(() => refreshTodoFilterBadge());
    };
    todoFileWatcher.onDidChange(onTodoFileChanged);
    todoFileWatcher.onDidCreate(onTodoFileChanged);

    const toggleCmd = vscode.commands.registerCommand(
        "superset.todoToggle",
        async (item: { line: number; checked: boolean; text: string; kind: "checkbox" | "list" } | undefined) => {
            if (!item) return;
            if (item.kind === "list") return;
            await store.toggle(item);
        }
    );

    const changePriorityCmd = vscode.commands.registerCommand(
        "superset.todoChangePriority",
        async (item: { line: number; checked: boolean; text: string; kind: "checkbox" | "list" } | undefined) => {
            if (!item || item.kind !== "checkbox") return;

            // Extract current priority from text
            const currentMatch = item.text.match(/^(\[|\()?(P[0-2])(\]|\))?/i);
            const currentPriority = currentMatch?.[2]?.toUpperCase() || null;

            const pick = await vscode.window.showQuickPick(
                [
                    { label: "P0", description: "Highest priority", priority: "P0" },
                    { label: "P1", description: "Medium priority", priority: "P1" },
                    { label: "P2", description: "Low priority", priority: "P2" },
                ],
                {
                    placeHolder: currentPriority ? `Current: ${currentPriority} — select new priority` : "Select priority",
                }
            );

            if (!pick) return;
            await store.updatePriority(item, pick.priority as "P0" | "P1" | "P2");
        }
    );

    const applyFilterToggle = () => {
        provider.toggleShowCompleted();
        refreshTodoFilterBadge();
    };

    const hideCompletedCmd = vscode.commands.registerCommand(
        "superset.todoFilterHideCompleted",
        applyFilterToggle
    );

    const showAllCmd = vscode.commands.registerCommand(
        "superset.todoFilterShowAll",
        applyFilterToggle
    );

    ctx.subscriptions.push(
        toggleCmd,
        changePriorityCmd,
        hideCompletedCmd,
        showAllCmd,
        view,
        todoFileWatcher,
        { dispose: () => provider.stop() }
    );

    return {
        dispose() {
            provider.stop();
            toggleCmd.dispose();
            changePriorityCmd.dispose();
            hideCompletedCmd.dispose();
            showAllCmd.dispose();
            view.dispose();
            todoFileWatcher.dispose();
        },
    };
}
