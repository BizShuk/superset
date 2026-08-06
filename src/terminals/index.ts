import * as vscode from "vscode";
import type { PluginContext } from "../plugin";
import { TerminalRegistry } from "./terminalRegistry";
import { OutputWatcher } from "./outputWatcher";
import { TerminalTreeProvider } from "./treeProvider";
import { HighlightPresenter } from "./highlightPresenter";
import { shouldTrackTerminal } from "./terminalFilter";
import { GroupStore } from "./groupStore";
import { WatchedTerminalTracker } from "./watchedTerminalTracker";
import { createTerminalDragAndDropController } from "./dragAndDrop";
import {
    createShellExecutionSource,
    createVscodeLifecycleSubscribers,
} from "./shellExecutionSource";
import { ActivityCoordinator } from "./activitySource";
import { createShellIntegrationActivitySource } from "./shellIntegrationActivitySource";
import { createProcessActivitySource } from "./processActivitySource";
import { runPsSnapshot, resolveTerminalPid } from "./processSnapshot";
import {
    registerTerminalCommands,
    registerGroupCommands,
} from "./commands";
import {
    installTerminalOpenTracker,
    installEditorFocusBridge,
} from "./lifecycle";
import { registerMermaidPreviewCommand } from "../mermaid/mermaidPreviewCommand";
import { registerViewVisibility } from "../plugin/viewVisibility";
import {
    captureSnapshot,
    renderActivityMarkdown,
} from "../terminalActivitySummary";
import { DIAGNOSTIC_METRIC } from "../diagnostics/metrics";

export function register(
    ctx: PluginContext,
    statusBar: vscode.StatusBarItem
): void {
    const log = ctx.log;
    const registry = new TerminalRegistry();
    const groupStore = new GroupStore();
    ctx.registerDiagnosticsProvider(() => ({
        [DIAGNOSTIC_METRIC.terminalCount]: registry.getAll().length,
        [DIAGNOSTIC_METRIC.unseenTerminalCount]: registry.getUnseen().length,
    }));

    // "Is the user watching this terminal?" state machine.
    const tracker = new WatchedTerminalTracker<vscode.Terminal>({
        initial: vscode.window.activeTerminal,
    });

    // Pre-populate registry and group store with already-open terminals.
    for (const terminal of vscode.window.terminals) {
        if (!shouldTrackTerminal(terminal.name)) {
            log(`[skip-track] "${terminal.name}": agent-owned (excluded from panel)`);
            continue;
        }
        registry.add(terminal);
        groupStore.assignDefaultGroup(terminal);
    }
    log(`pre-populated ${vscode.window.terminals.length} terminal(s)`);

    // Wire TerminalTreeProvider to a TreeView.
    const treeProvider = new TerminalTreeProvider(registry, groupStore);
    treeProvider.start();

    // Diagnostic: log every registry change.
    registry.onDidChange((change) => {
        if (change.type === "unseenChanged") {
            log(
                `registry.unseenChanged: "${change.terminal.name}" → ${change.hasUnseenOutput}`
            );
        } else if (change.type === "added") {
            log(`registry.added: "${change.terminal.name}"`);
        } else if (change.type === "removed") {
            log(`registry.removed: "${change.terminal.name}"`);
        }
    });

    const treeView = vscode.window.createTreeView("superset.terminals", {
        treeDataProvider: treeProvider,
        dragAndDropController: createTerminalDragAndDropController(
            groupStore,
            treeProvider
        ),
        showCollapseAll: true,
    });
    treeView.message = `Window: ${vscode.env.sessionId.slice(0, 8)}`;

    // Wire into the cross-panel TreeViewRegistry so the
    // `superset.revealInTree` command and the `superset.revealTerminal`
    // shortcut can walk this panel's tree. The returned disposable
    // lives in the panel's `disposables` chain so deactivation evicts
    // the registry entry (see `disposables` near the end of register()).
    ctx.registerTreeView(
        "superset.terminals",
        treeView,
        treeProvider
    );

    // Report active view for panel-layout persistence (plan §3). Only
    // `visible: true` transitions matter — when the panel hides, another
    // panel will report its own `true`, which becomes the new active.
    const visibilitySub = registerViewVisibility(
        treeView,
        "superset.terminals",
        (visible) => treeProvider.setVisible(visible)
    );

    // Wire HighlightPresenter against the shared status bar.
    const presenter = new HighlightPresenter({
        registry,
        setTerminalName: (terminal, name) => {
            (terminal as unknown as { name: string }).name = name;
        },
        setStatusBarText: (text) => {
            statusBar.text = text;
        },
        showStatusBar: () => statusBar.show(),
        hideStatusBar: () => statusBar.hide(),
        setStatusBarCommand: () => {
            statusBar.command = "superset.focusView";
        },
        clearStatusBarCommand: () => {
            statusBar.command = undefined;
        },
        log,
    });
    presenter.start();

    // ── Activity detection ───────────────────────────────
    //
    // Two byte-free sources feed `markUnseen`:
    //   A `processActivitySource`  — polls the process tree (covers TUIs
    //     like `claude` / `vim`, which shell integration cannot see into)
    //   B `shellIntegrationActivitySource` — start/end execution edges,
    //     without ever calling `execution.read()`
    //
    // Neither moves terminal output through the extension host, so neither
    // can starve the event loop the way the byte-reading path does.
    const lifecycle = createVscodeLifecycleSubscribers();
    const activity = new ActivityCoordinator({
        registry,
        getActiveTerminal: () => tracker.watched,
        isRecentlyActive: (terminal) =>
            tracker.isRecentlyActive(terminal as vscode.Terminal),
        log,
        sources: [
            createShellIntegrationActivitySource({
                onDidStart: lifecycle.onDidStart,
                onDidEnd: lifecycle.onDidEnd,
                log,
            }),
            createProcessActivitySource({
                runPs: runPsSnapshot,
                getTerminals: () => registry.getAll().map((e) => e.terminal),
                resolvePid: resolveTerminalPid,
                log,
            }),
        ],
    });
    activity.start();
    log("ActivityCoordinator started (sources: shell-integration, process-tree)");

    // Legacy byte-reading watcher. Off by default: it drains
    // `execution.read()` for every execution, which is the path that made
    // the diagnostic channel a load-bearing performance problem (one
    // `JSON.stringify` + `appendLine` per chunk). Kept behind a setting so
    // the old behaviour is recoverable while A/B are being validated.
    const legacyWatcherEnabled = vscode.workspace
        .getConfiguration("superset.terminals")
        .get<boolean>("legacyOutputWatcher", false);
    const watcher = legacyWatcherEnabled
        ? new OutputWatcher({
              registry,
              getActiveTerminal: () => tracker.watched,
              isRecentlyActive: (terminal) =>
                  tracker.isRecentlyActive(terminal as vscode.Terminal),
              log,
              onShellExecution: createShellExecutionSource(log),
          })
        : undefined;
    watcher?.start();
    log(
        `OutputWatcher ${legacyWatcherEnabled ? "started (legacy)" : "disabled"}`
    );

    const getCwd = () =>
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    // ── Mermaid preview command ───────────────────────────────
    //
    // Detection (buffer + terminal-link provider) was removed; the
    // command stays so external callers — other extensions, command
    // palette, or future re-introduction of detection — can still
    // invoke `superset.mermaidPreview` with a body.
    const offMermaidPreviewCmd = registerMermaidPreviewCommand({ log });
    log("mermaid preview command registered");

    // ── Lifecycle subscriptions ──────────────────────────

    const openSub = installTerminalOpenTracker({ registry, log });

    const closeSub = vscode.window.onDidCloseTerminal((terminal) => {
        registry.remove(terminal);
    });

    const activeChangeSub = vscode.window.onDidChangeActiveTerminal((terminal) => {
        log(`active-changed: "${terminal?.name ?? "<none>"}"`);
        tracker.setWatched(terminal);
        if (!terminal) {
            return;
        }
        registry.clearUnseen(terminal);
    });

    const editorFocusSub = installEditorFocusBridge({
        tracker,
        registry,
        log,
    });

    // ── Commands ─────────────────────────────────────────

    // Terminal Activity Summary — snapshots the registry into a
    // temporary Markdown document and opens it in the markdown
    // preview. Closes the gap where the panel only surfaces a
    // boolean "unseen" indicator — the user gets a per-terminal
    // table (PID, cwd, hidden, unseen) plus per-terminal details in
    // one read.
    const activitySummaryCmd = vscode.commands.registerCommand(
        "superset.terminalActivitySummary",
        async () => {
            const rows = captureSnapshot(registry);
            const md = renderActivityMarkdown(rows, new Date());
            const doc = await vscode.workspace.openTextDocument({
                content: md,
                language: "markdown",
            });
            await vscode.commands.executeCommand(
                "markdown.showPreview",
                doc.uri
            );
        }
    );

    const commandSubs = [
        ...registerTerminalCommands({
            registry,
            treeProvider,
            spawnTerminal: ctx.createTerminal,
            getCwd,
            revealTerminal: (terminal) =>
                ctx.revealInTree(
                    "superset.terminals",
                    (item) => item === terminal
                ),
        }),
        ...registerGroupCommands(groupStore),
        activitySummaryCmd,
    ];

    // ── Register disposables ─────────────────────────────
    //
    // Single source of truth: register every resource in the plugin-owned
    // disposable pool.

    const disposables: vscode.Disposable[] = [
        treeView,
        { dispose: () => treeProvider.stop() },
        { dispose: () => presenter.stop() },
        { dispose: () => activity.stop() },
        { dispose: () => watcher?.stop() },
        openSub,
        closeSub,
        activeChangeSub,
        editorFocusSub,
        visibilitySub,
        offMermaidPreviewCmd,
        ...commandSubs,
    ];

    for (const disposable of disposables) {
        ctx.registerDisposable(disposable);
    }
}
