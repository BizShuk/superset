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
        async (item: { line: number; checked: boolean; text: string; kind: "checkbox" | "list" | "section" } | undefined) => {
            if (!item || item.kind !== "checkbox") return;

            // Extract current priority from text
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
            await store.updatePriority(item as any, pick.label as "P0" | "P1" | "P2" | "None");
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
        async () => {
            const text = await vscode.window.showInputBox({
                prompt: "新增待辦事項描述 (New TODO Description)",
                placeHolder: "輸入待辦事項內容...",
            });
            if (!text || text.trim() === "") return;

            await store.addTodo(text.trim(), "Default");
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

    const archiveTodoCmd = vscode.commands.registerCommand(
        "superset.todoArchive",
        async (item?: TodoItem) => {
            if (!item) return;
            await store.archiveTodo(item);
        }
    );

    const changeSectionCmd = vscode.commands.registerCommand(
        "superset.todoChangeSection",
        async (item?: TodoItem) => {
            if (!item) return;

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

    const todoRenameCmd = vscode.commands.registerCommand(
        "superset.todoRename",
        async (item?: TodoItem) => {
            if (!item) return;
            if (item.kind !== "checkbox" && item.kind !== "list") return;

            const newText = await vscode.window.showInputBox({
                prompt: "重新命名待辦事項 (Rename TODO Item)",
                value: item.text,
            });

            if (newText === undefined) return;
            const trimmed = newText.trim();
            if (trimmed === "" || trimmed === item.text) return;

            await store.updateText(item.line, trimmed);
        }
    );

    const viewSecCmd = vscode.commands.registerCommand(
        "superset.todoViewSec",
        () => {
            provider.setViewType("priority");
        }
    );

    const viewPXCmd = vscode.commands.registerCommand(
        "superset.todoViewPX",
        () => {
            provider.setViewType("file");
        }
    );

    const viewFileCmd = vscode.commands.registerCommand(
        "superset.todoViewFile",
        () => {
            provider.setViewType("section");
        }
    );

    ctx.subscriptions.push(
        toggleCmd,
        changePriorityCmd,
        todoNewCmd,
        openTodoFileCmd,
        openTodoLinkCmd,
        copyTodoCmd,
        archiveTodoCmd,
        changeSectionCmd,
        deleteSectionCmd,
        todoRenameCmd,
        viewSecCmd,
        viewPXCmd,
        viewFileCmd,
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
            archiveTodoCmd.dispose();
            changeSectionCmd.dispose();
            deleteSectionCmd.dispose();
            todoRenameCmd.dispose();
            viewSecCmd.dispose();
            viewPXCmd.dispose();
            viewFileCmd.dispose();
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

