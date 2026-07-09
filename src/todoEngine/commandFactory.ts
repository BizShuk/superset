// Command factory — emit `vscode.commands.registerCommand` for every
// todoEngine logical command, parameterised by `commandPrefix` so the
// same code path produces `superset.todo*` and `superset.projectsTodo*`.
//
// Each panel calls `createTodoCommands(ctx)` once during register() and
// adds the returned disposables to its FeatureHandle.dispose() list.
// Per-panel differences (which store method, which path) flow through
// the `TodoCommandContext` — the factory itself is pure command
// assembly with zero behavior.

import * as path from "node:path";
import * as vscode from "vscode";
import {
    type TodoCommandContext,
    type TodoCommandSet,
    type TodoEngineItem,
} from "./types";

/** A single command registration returned by the factory. Stored as
 *  a tuple so the caller can dispose of them in the right order. */
interface RegisteredCommand {
    /** Command id, e.g. `superset.todoToggle`. */
    id: string;
    /** The disposable returned by `vscode.commands.registerCommand`. */
    disposable: vscode.Disposable;
    /** Logical name, e.g. `Toggle`. Useful for tests + menu wiring. */
    logical: string;
}

export function createTodoCommands(
    ctx: TodoCommandContext
): TodoCommandSet {
    const id = (suffix: string): string =>
        `superset.${ctx.prefix}${suffix}`;
    const registrations: RegisteredCommand[] = [];
    const add = (
        logical: string,
        suffix: string,
        handler: (...args: unknown[]) => unknown
    ): void => {
        registrations.push({
            id: id(suffix),
            logical,
            disposable: vscode.commands.registerCommand(
                id(suffix),
                handler
            ),
        });
    };

    // ── Filter / view-type ─────────────────────────────────────
    const applyFilterToggle = (): void => {
        ctx.treeProvider.toggleShowCompleted();
        refreshFilterBadge();
    };
    const syncPriorityContext = (): void => {
        void vscode.commands.executeCommand(
            "setContext",
            `${ctx.prefix}.filterP0`,
            ctx.treeProvider.isPriorityEnabled("P0")
        );
        void vscode.commands.executeCommand(
            "setContext",
            `${ctx.prefix}.filterP1`,
            ctx.treeProvider.isPriorityEnabled("P1")
        );
        void vscode.commands.executeCommand(
            "setContext",
            `${ctx.prefix}.filterP2`,
            ctx.treeProvider.isPriorityEnabled("P2")
        );
    };
    const refreshFilterBadge = (): void => {
        // The actual title update + context-key push is performed by
        // the panel's register() (it owns the TreeView and the title
        // string template). This thunk delegates back through a
        // callback the panel wires in.
        ctx.refreshTree();
    };
    add("FilterHideCompleted", "FilterHideCompleted", applyFilterToggle);
    add("FilterShowAll", "FilterShowAll", applyFilterToggle);

    // Priority filter buttons. Each priority needs two command
    // ids (the dim "off" variant + the filled "on" variant) so the
    // `when`-clause in package.json can swap the icon — the icon
    // is taken from the registered command at registration time.
    // Both variants call the same toggle handler.
    const togglePriority = (p: "P0" | "P1" | "P2") => (): void => {
        ctx.treeProvider.togglePriority(p);
        syncPriorityContext();
        refreshFilterBadge();
    };
    add("FilterP0Toggle", "FilterP0", togglePriority("P0"));
    add("FilterP0ToggleOn", "FilterP0On", togglePriority("P0"));
    add("FilterP1Toggle", "FilterP1", togglePriority("P1"));
    add("FilterP1ToggleOn", "FilterP1On", togglePriority("P1"));
    add("FilterP2Toggle", "FilterP2", togglePriority("P2"));
    add("FilterP2ToggleOn", "FilterP2On", togglePriority("P2"));
    add("ViewSec", "ViewSec", () =>
        ctx.treeProvider.setViewType("section")
    );
    add("ViewPX", "ViewPX", () =>
        ctx.treeProvider.setViewType("priority")
    );
    add("ViewFile", "ViewFile", () =>
        ctx.treeProvider.setViewType("file")
    );

    // ── Mutation commands ──────────────────────────────────────
    add("Toggle", "Toggle", async (raw?: unknown) => {
        const item = (raw ?? ctx.getActiveItem()) as
            | TodoEngineItem
            | undefined;
        if (!item) return;
        if (item.kind === "list" || item.kind === "plan") return;
        await ctx.store.toggle(item);
    });

    add("ChangePriority", "ChangePriority", async (raw?: unknown) => {
        const item = (raw ?? ctx.getActiveItem()) as
            | TodoEngineItem
            | undefined;
        if (!item || item.kind !== "checkbox") return;
        const currentMatch = item.text.match(
            /^(\[|\()?(P[0-2])(\]|\))?/i
        );
        const currentPriority =
            currentMatch?.[2]?.toUpperCase() || "None";
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
        await ctx.store.updatePriority(
            item,
            pick.label as "P0" | "P1" | "P2" | "None"
        );
    });

    add("New", "New", async (raw?: unknown) => {
        const item = raw as TodoEngineItem | undefined;
        const sectionName =
            item?.kind === "section" ? item.text : "Default";
        const text = await vscode.window.showInputBox({
            prompt: "新增待辦事項描述 (New TODO Description)",
            placeHolder: "輸入待辦事項內容...",
        });
        if (!text || text.trim() === "") return;
        await ctx.store.addTodo(text.trim(), sectionName);
    });

    add("Open", "Open", async () => {
        const uri = vscode.Uri.file(
            path.join(ctx.workspaceFolder, "README.todo")
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
            ctx.showError(`Failed to open README.todo: ${err}`);
        }
    });

    add("OpenLink", "OpenLink", async (raw?: unknown) => {
        const item = raw as TodoEngineItem | undefined;
        if (!item) return;
        // Plan rows: open the backing `.md` file directly. The
        // factory delegates the actual link extraction to the panel
        // (which knows the workspaceFolder + parser); the panel can
        // attach this command to a higher-level handler. Here we
        // emit a no-op-ish "call the panel" hook by reading filePath.
        if (item.kind === "plan") {
            if (!item.filePath) return;
            const uri = vscode.Uri.file(item.filePath);
            try {
                const doc = await vscode.workspace.openTextDocument(
                    uri
                );
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
                ctx.showError(`Failed to open plan: ${err}`);
            }
            return;
        }
        // For non-plan rows the panel knows how to extract a link
        // from the text. We expose a thin indirection by
        // re-dispatching through the same command id with a hint —
        // the panel's wired handler is responsible for the
        // extract/resolve. Here we keep the link-opener behavior
        // inside the panel because the workspaceFolder-relative
        // resolution is panel-specific. See
        // `resolveTodoLink` in src/todo/todoTreeProvider.ts for the
        // single-file panel; projectsTodo resolves through its own
        // sub-store link map.
        // No-op fallback: panels are expected to wrap this command
        // with their own OpenLink handler if they need panel-aware
        // link resolution. The factory registers the command id so
        // the menu wiring in `package.json` keeps matching.
        ctx.log("todoEngine.OpenLink: panel should override");
    });

    // ── Plan lifecycle ──────────────────────────────────────────
    const runPlanAction =
        (action: "complete" | "backlog" | "archive" | "delete") =>
        async (raw?: unknown): Promise<void> => {
            const item = raw as TodoEngineItem | undefined;
            if (!item?.filePath) return;
            const basename = path.basename(item.filePath);
            try {
                await ctx.planActions[action](
                    ctx.workspaceFolder,
                    basename
                );
                if (ctx.store.reset) {
                    await ctx.store.reset();
                }
                const messages = {
                    complete: `Plan moved to docs/specs/: ${basename}`,
                    backlog: `Plan moved to docs/backlog/: ${basename}`,
                    archive: `Plan moved to plans/archive/: ${basename}`,
                    delete: `Plan deleted: ${basename}`,
                } as const;
                ctx.showInfo(messages[action]);
            } catch (err) {
                ctx.reportPlanActionError?.(action, basename, err);
            }
        };

    add("CompletePlan", "CompletePlan", runPlanAction("complete"));
    add("BacklogPlan", "BacklogPlan", runPlanAction("backlog"));
    add("ArchivePlan", "ArchivePlan", runPlanAction("archive"));
    add("DeletePlan", "DeletePlan", runPlanAction("delete"));

    // ── Item-level mutations ───────────────────────────────────
    add("Copy", "Copy", async (raw?: unknown) => {
        // The factory doesn't know how to format per-row copy text
        // (plans vs checkbox vs list) — the panel knows. So we
        // register a thin command that the panel's own
        // `superset.<prefix>.Copy` registration will shadow if
        // necessary. For now, we just no-op; panels can override.
        ctx.log(
            "todoEngine.Copy: panel should override with formatPlanCopyText"
        );
    });

    add("Archive", "Archive", async (raw?: unknown) => {
        const item = raw as TodoEngineItem | undefined;
        if (!item) return;
        await ctx.store.archiveTodo(item);
    });

    add("Rollback", "Rollback", async (raw?: unknown) => {
        const item = raw as TodoEngineItem | undefined;
        if (!item) return;
        await ctx.store.rollbackTodo(item);
    });

    add("ArchiveSection", "ArchiveSection", async (raw?: unknown) => {
        const item = raw as TodoEngineItem | undefined;
        if (!item) return;
        await ctx.store.archiveSection(item);
    });

    add("UnarchiveSection", "UnarchiveSection", async (raw?: unknown) => {
        const item = raw as TodoEngineItem | undefined;
        if (!item) return;
        await ctx.store.unarchiveSection(item);
    });

    add("ChangeSection", "ChangeSection", async (raw?: unknown) => {
        // The factory doesn't drive the QuickPick; the panel
        // supplies the section list (because projectsTodo has many
        // sections and needs a project picker first). We delegate
        // through a marker so the panel can register its own
        // superseding handler if needed. Default: ask the panel.
        ctx.log(
            "todoEngine.ChangeSection: panel should override with QuickPick"
        );
    });

    add("DeleteSection", "DeleteSection", async (raw?: unknown) => {
        const item = raw as TodoEngineItem | undefined;
        if (!item) return;
        await ctx.store.deleteSection(item);
    });

    add("Rename", "Rename", async (raw?: unknown) => {
        const item = raw as TodoEngineItem | undefined;
        if (!item || item.line < 0) return;
        const newText = await vscode.window.showInputBox({
            prompt: "新描述 (New Description)",
            value: item.text,
        });
        if (newText === undefined) return;
        await ctx.store.updateText(item.line, newText);
    });

    add("Delete", "Delete", async (raw?: unknown) => {
        const item = raw as TodoEngineItem | undefined;
        if (!item) return;
        await ctx.store.deleteTodo(item);
    });

    return {
        disposables: registrations.map((r) => r.disposable),
        applyFilterToggle,
        syncPriorityContext,
        refreshFilterBadge,
    };
}

/** Helper: build a `(item) => ctx.workspaceFolder` style basename
 *  path for the plan actions to consume. */
export function planBasename(item: TodoEngineItem): string | undefined {
    if (!item.filePath) return undefined;
    return path.basename(item.filePath);
}
