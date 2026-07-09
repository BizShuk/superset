import * as vscode from "vscode";
import * as path from "path";
import type { FeatureContext, FeatureHandle } from "../shared";
import { TodoStore } from "./todoStore";
import { TodoTreeProvider, extractLink, resolveTodoLink } from "./todoTreeProvider";
import { computeTodoBadgeTitle } from "./badge";
import {
    completePlan as completePlanFs,
    backlogPlan as backlogPlanFs,
    archivePlan as archivePlanFs,
    deletePlan as deletePlanFs,
    PlanActionError,
} from "./planActions";
import { formatPlanCopyText } from "./plansSource";
import type { TodoItem } from "./types";

const TODO_VIEW_TITLE = "TODO";

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

    const toggleCmd = vscode.commands.registerCommand(
        "superset.todoToggle",
        async (item: { line: number; checked: boolean; text: string; kind: "checkbox" | "list" | "plan" } | undefined) => {
            if (!item) return;
            if (item.kind === "list") return;
            // Plan items are read-only — never toggleable. The menu
            // doesn't show this command for plan rows anyway (the
            // contextValue is `todoPlan`, not `todoCheckbox`).
            if (item.kind === "plan") return;
            await store.toggle(item);
        }
    );

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

    const changePriorityCmd = vscode.commands.registerCommand(
        "superset.todoChangePriority",
        async (item: { line: number; checked: boolean; text: string; kind: "checkbox" | "list" | "plan" | "section" } | undefined) => {
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
    const completePlanCmd = vscode.commands.registerCommand(
        "superset.todoCompletePlan",
        async (item?: TodoItem) => {
            if (!item?.filePath) return;
            const basename = path.basename(item.filePath);
            try {
                await completePlanFs(ctx.workspaceFolder, basename);
                await store.reset();
                vscode.window.showInformationMessage(
                    `Plan moved to docs/specs/: ${basename}`,
                );
            } catch (err) {
                reportPlanActionError("complete", basename, err);
            }
        }
    );

    const backlogPlanCmd = vscode.commands.registerCommand(
        "superset.todoBacklogPlan",
        async (item?: TodoItem) => {
            if (!item?.filePath) return;
            const basename = path.basename(item.filePath);
            try {
                await backlogPlanFs(ctx.workspaceFolder, basename);
                await store.reset();
                vscode.window.showInformationMessage(
                    `Plan moved to docs/backlog/: ${basename}`,
                );
            } catch (err) {
                reportPlanActionError("backlog", basename, err);
            }
        }
    );

    const archivePlanCmd = vscode.commands.registerCommand(
        "superset.todoArchivePlan",
        async (item?: TodoItem) => {
            if (!item?.filePath) return;
            const basename = path.basename(item.filePath);
            try {
                await archivePlanFs(ctx.workspaceFolder, basename);
                await store.reset();
                vscode.window.showInformationMessage(
                    `Plan moved to plans/archive/: ${basename}`,
                );
            } catch (err) {
                reportPlanActionError("archive", basename, err);
            }
        }
    );

    const deletePlanCmd = vscode.commands.registerCommand(
        "superset.todoDeletePlan",
        async (item?: TodoItem) => {
            if (!item?.filePath) return;
            const basename = path.basename(item.filePath);
            try {
                await deletePlanFs(ctx.workspaceFolder, basename);
                await store.reset();
                vscode.window.showInformationMessage(`Plan deleted: ${basename}`);
            } catch (err) {
                reportPlanActionError("delete", basename, err);
            }
        }
    );

    const copyTodoCmd = vscode.commands.registerCommand(
        "superset.todoCopy",
        async (item?: TodoItem) => {
            if (!item || !item.text) return;
            try {
                // Plan rows: copy `[title](file://...)` so the user
                // can paste a clickable Markdown link into another
                // doc. Falls back to plain text if `formatPlanCopyText`
                // rejects the input (defensive — should not happen
                // for menu-driven invocations on a plan row).
                const planCopy = formatPlanCopyText(item);
                const payload = planCopy ?? item.text;
                await vscode.env.clipboard.writeText(payload);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to copy: ${err}`);
            }
        }
    );

    const archiveTodoCmd = vscode.commands.registerCommand(
        "superset.todoArchive",
        async (item?: TodoItem) => {
            if (!item) return;
            if (item.kind === "plan") return;
            await store.archiveTodo(item);
        }
    );

    const rollbackTodoCmd = vscode.commands.registerCommand(
        "superset.todoRollback",
        async (item?: TodoItem) => {
            if (!item) return;
            if (item.kind === "plan") return;
            await store.rollbackTodo(item);
        }
    );

    const archiveSectionCmd = vscode.commands.registerCommand(
        "superset.todoArchiveSection",
        async (item?: TodoItem) => {
            if (!item) return;
            await store.archiveSection(item);
        }
    );

    const unarchiveSectionCmd = vscode.commands.registerCommand(
        "superset.todoUnarchiveSection",
        async (item?: TodoItem) => {
            if (!item) return;
            await store.unarchiveSection(item);
        }
    );

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
        plansWatcher,
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
            plansWatcher.dispose();
        },
    };
}

