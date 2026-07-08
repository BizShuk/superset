import * as vscode from "vscode";
import * as path from "path";
import type { FeatureContext, FeatureHandle } from "../shared";
import { ProjectsTodoStore } from "./projectsTodoStore";
import { ProjectsTodoTreeProvider } from "./projectsTodoTreeProvider";
import { computeTodoBadgeTitle } from "../todo/badge";
import { extractLink, resolveTodoLink } from "../todo/todoTreeProvider";
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

    // Drive the native checkbox click
    view.onDidChangeCheckboxState?.(async (e) => {
        for (const [item] of e.items) {
            const pItem = item as ProjectTodoItem;
            if (pItem.kind === "checkbox") {
                const subStore = store.getStore(pItem.projectPath);
                if (subStore) {
                    await subStore.toggle(pItem);
                }
            }
        }
    });

    const openProjectCmd = vscode.commands.registerCommand(
        "superset.openProject",
        async (item?: ProjectTodoItem) => {
            const projectPath = item?.projectPath;
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
                const activeProjects = Array.from(store.getStores().keys()).map(p => ({
                    label: path.basename(p),
                    description: p
                }));
                if (activeProjects.length === 0) {
                    vscode.window.showErrorMessage("無可用的專案項目 (No projects available)");
                    return;
                }
                const pick = await vscode.window.showQuickPick(activeProjects, {
                    placeHolder: "選擇專案以新增待辦事項 (Select project to add TODO)"
                });
                if (!pick) return;
                projectPath = pick.description;
            }

            const text = await vscode.window.showInputBox({
                prompt: "新增待辦事項描述 (New TODO Description)",
                placeHolder: "輸入待辦事項內容...",
            });
            if (!text || text.trim() === "") return;

            const subStore = store.getStore(projectPath);
            if (subStore) {
                await subStore.addTodo(text.trim(), "Default");
            }
        }
    );

    const openTodoFileCmd = vscode.commands.registerCommand(
        "superset.projectsTodoOpen",
        async (item?: ProjectTodoItem) => {
            let projectPath = item?.projectPath;
            if (!projectPath) {
                const activeProjects = Array.from(store.getStores().keys()).map(p => ({
                    label: path.basename(p),
                    description: p
                }));
                if (activeProjects.length === 0) {
                    // Fallback to workspace root
                    projectPath = ctx.workspaceFolder;
                } else if (activeProjects.length === 1) {
                    projectPath = activeProjects[0]!.description;
                } else {
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

    const openTodoLinkCmd = vscode.commands.registerCommand(
        "superset.projectsTodoOpenLink",
        async (item?: ProjectTodoItem) => {
            if (!item) return;
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

    const copyTodoCmd = vscode.commands.registerCommand(
        "superset.projectsTodoCopy",
        async (item?: ProjectTodoItem) => {
            if (!item || !item.text) return;
            try {
                await vscode.env.clipboard.writeText(item.text);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to copy todo text: ${err}`);
            }
        }
    );

    const archiveTodoCmd = vscode.commands.registerCommand(
        "superset.projectsTodoArchive",
        async (item?: ProjectTodoItem) => {
            if (!item) return;
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
        },
    };
}
