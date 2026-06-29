import * as vscode from "vscode";
import * as path from "path";
import type { FeatureContext, FeatureHandle } from "../shared";
import { TodoStore } from "./todoStore";
import { TodoTreeProvider, extractLink, resolveTodoLink } from "./todoTreeProvider";
import { computeTodoBadgeTitle } from "./badge";
import type { TodoItem } from "./types";

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

    // Drive the native checkbox click. The framework only fires this when
    // the checkbox icon (not the row text) is clicked. Each entry is the
    // (item, newState) pair the framework hands us — we forward to the
    // store, which writes the file and emits the change that re-renders.
    view.onDidChangeCheckboxState?.(async (e) => {
        for (const [item] of e.items) {
            if (item.kind === "checkbox") {
                await store.toggle(item);
            }
        }
    });

    const changePriorityCmd = vscode.commands.registerCommand(
        "superset.todoChangePriority",
        async (item: { line: number; checked: boolean; text: string; kind: "checkbox" | "list" } | undefined) => {
            if (!item || item.kind !== "checkbox") return;

            // Extract current priority from text
            const currentMatch = item.text.match(/^(\[|\()?(P[0-2])(\]|\))?/i);
            const currentPriority = currentMatch?.[2]?.toUpperCase() || null;

            const pick = await vscode.window.showQuickPick(
                [
                    { label: "P0", description: "Highest priority" },
                    { label: "P1", description: "Medium priority" },
                    { label: "P2", description: "Low priority" },
                ],
                {
                    placeHolder: currentPriority ? `Current: ${currentPriority} — select new priority` : "Select priority",
                }
            );

            if (!pick) return;
            await store.updatePriority(item, pick.label as "P0" | "P1" | "P2");
        }
    );

    const applyFilterToggle = () => {
        provider.toggleShowCompleted();
        refreshTodoFilterBadge();
    };

    // Sync the active priority filter state into VS Code context keys so
    // the view-title buttons can swap icons (`$(filter-filled)` active vs
    // `$(filter)` inactive).
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

    // Each priority filter has two command ids bound to the same toggle:
    // `superset.todoFilter{P}` (dim icon, shown when inactive) and
    // `superset.todoFilter{P}On` (coloured icon, shown when active). VSCode
    // takes a button's icon from the *command* (menu-level `icon` is ignored),
    // so swapping the icon by state requires two distinct commands — same
    // pattern as todoFilterHideCompleted / todoFilterShowAll.
    const makePriorityToggleCmds = (p: "P0" | "P1" | "P2") => {
        const handler = () => {
            provider.togglePriorityFilter(p);
            syncPriorityContext();
            refreshTodoFilterBadge();
        };
        return [
            vscode.commands.registerCommand(`superset.todoFilter${p}`, handler),
            vscode.commands.registerCommand(`superset.todoFilter${p}On`, handler),
        ];
    };

    const [filterP0Cmd, filterP0OnCmd] = makePriorityToggleCmds("P0");
    const [filterP1Cmd, filterP1OnCmd] = makePriorityToggleCmds("P1");
    const [filterP2Cmd, filterP2OnCmd] = makePriorityToggleCmds("P2");

    // Push initial context-key state.
    syncPriorityContext();

    const hideCompletedCmd = vscode.commands.registerCommand(
        "superset.todoFilterHideCompleted",
        applyFilterToggle
    );

    const showAllCmd = vscode.commands.registerCommand(
        "superset.todoFilterShowAll",
        applyFilterToggle
    );

    const todoNewCmd = vscode.commands.registerCommand(
        "superset.todoNew",
        async (item?: TodoItem) => {
            const text = await vscode.window.showInputBox({
                prompt: "新增待辦事項描述 (New TODO Description)",
                placeHolder: "輸入待辦事項內容...",
            });
            if (!text || text.trim() === "") return;

            let section = "modify";
            if (item && item.kind === "section") {
                section = item.text;
            } else {
                const secInput = await vscode.window.showInputBox({
                    prompt: "請輸入區段名稱 (Section Name)",
                    value: "modify",
                });
                if (secInput === undefined) return; // User cancelled
                if (secInput.trim() !== "") {
                    section = secInput.trim();
                }
            }

            await store.addTodo(text.trim(), section);
        }
    );

    const openTodoFileCmd = vscode.commands.registerCommand(
        "superset.todoOpen",
        async () => {
            const uri = vscode.Uri.file(path.join(ctx.workspaceFolder, "README.todo"));
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open README.todo: ${err}`);
            }
        }
    );

    const openTodoLinkCmd = vscode.commands.registerCommand(
        "superset.todoOpenLink",
        async (item?: TodoItem) => {
            if (!item) return;
            const target = extractLink(item.text);
            if (!target) return;

            try {
                const resolved = resolveTodoLink(target, ctx.workspaceFolder);
                if (resolved.type === "url") {
                    await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(resolved.uriOrPath));
                } else {
                    const uri = vscode.Uri.file(resolved.uriOrPath);
                    await vscode.commands.executeCommand("vscode.open", uri);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open link: ${err}`);
            }
        }
    );

    const copyTodoCmd = vscode.commands.registerCommand(
        "superset.todoCopy",
        async (item?: TodoItem) => {
            if (!item || !item.text) return;
            try {
                await vscode.env.clipboard.writeText(item.text);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to copy todo text: ${err}`);
            }
        }
    );

    ctx.subscriptions.push(
        toggleCmd,
        changePriorityCmd,
        todoNewCmd,
        openTodoFileCmd,
        openTodoLinkCmd,
        copyTodoCmd,
        hideCompletedCmd,
        showAllCmd,
        filterP0Cmd,
        filterP0OnCmd,
        filterP1Cmd,
        filterP1OnCmd,
        filterP2Cmd,
        filterP2OnCmd,
        view,
        todoFileWatcher,
        { dispose: () => provider.stop() }
    );

    return {
        dispose() {
            provider.stop();
            toggleCmd.dispose();
            changePriorityCmd.dispose();
            todoNewCmd.dispose();
            openTodoFileCmd.dispose();
            openTodoLinkCmd.dispose();
            copyTodoCmd.dispose();
            hideCompletedCmd.dispose();
            showAllCmd.dispose();
            filterP0Cmd.dispose();
            filterP0OnCmd.dispose();
            filterP1Cmd.dispose();
            filterP1OnCmd.dispose();
            filterP2Cmd.dispose();
            filterP2OnCmd.dispose();
            view.dispose();
            todoFileWatcher.dispose();
        },
    };
}
