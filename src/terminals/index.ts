import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import { TerminalRegistry } from "./terminalRegistry";
import { OutputWatcher } from "./outputWatcher";
import { TerminalTreeProvider } from "./treeProvider";
import { HighlightPresenter } from "./highlightPresenter";
import { shouldTrackTerminal } from "./autoReplace";
import { GroupStore } from "./groupStore";
import { WatchedTerminalTracker } from "./watchedTerminalTracker";
import { createTerminalDragAndDropController } from "./dragAndDrop";
import {
    PtyTerminalFactory,
    createNodePtySpawner,
} from "./ptyTerminalFactory";
import { createShellExecutionSource } from "./shellExecutionSource";
import {
    registerTerminalCommands,
    registerGroupCommands,
} from "./commands";
import {
    installAutoPtyReplacer,
    installEditorFocusBridge,
} from "./lifecycle";
import { setTerminalSpawner } from "../crossModuleState/terminalSpawner";
import {
    captureSnapshot,
    renderActivityMarkdown,
} from "../terminalActivitySummary";

export function register(ctx: FeatureContext): FeatureHandle {
    const log = ctx.shared.log;
    const registry = new TerminalRegistry();
    const groupStore = new GroupStore();

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

    // Report active view for panel-layout persistence (plan §3). Only
    // `visible: true` transitions matter — when the panel hides, another
    // panel will report its own `true`, which becomes the new active.
    const visibilitySub = treeView.onDidChangeVisibility((visible) => {
        if (visible) {
            void vscode.commands.executeCommand(
                "superset.reportViewVisible",
                "superset.terminals"
            );
        }
    });

    // Wire HighlightPresenter against the shared status bar.
    const statusBar = ctx.shared.statusBar;
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

    // OutputWatcher: Shell Integration events for pre-existing terminals.
    const watcher = new OutputWatcher({
        registry,
        getActiveTerminal: () => tracker.watched,
        isRecentlyActive: (terminal) =>
            tracker.isRecentlyActive(terminal as vscode.Terminal),
        log,
        onShellExecution: createShellExecutionSource(log),
    });
    watcher.start();
    log("OutputWatcher started");

    // PTY-backed terminal factory (100% TUI interception).
    const ptyFactory = new PtyTerminalFactory({
        registry,
        getWatched: () => tracker.watched,
        isRecentlyActive: (terminal) =>
            tracker.isRecentlyActive(terminal as vscode.Terminal),
        spawn: createNodePtySpawner(),
        log,
    });
    const getCwd = () =>
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    // Publish the spawner so other features (install commands in
    // globalCommandsPlugin) can create a PTY-backed terminal without
    // re-implementing the factory. Plain `vscode.window.createTerminal`
    // calls would hit the auto-PTY layer below and get disposed 150ms
    // later — which is exactly what made `go install` and `skills add`
    // silently no-op in 0.8.10/0.8.11.
    setTerminalSpawner((name, cwd) => ptyFactory.spawn(name, cwd));

    // ── Lifecycle subscriptions ──────────────────────────

    const openSub = installAutoPtyReplacer({
        registry,
        ptyFactory,
        getCwd,
        log,
    });

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
    // table (PID, cwd, hidden, PTY, unseen) plus per-terminal
    // details in one read.
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
            spawnPty: (name, cwd) => ptyFactory.spawn(name, cwd),
            getCwd,
        }),
        ...registerGroupCommands(groupStore),
        activitySummaryCmd,
    ];

    // ── Register disposables ─────────────────────────────
    //
    // Single source of truth: collect every disposable once, push to the
    // composition root's subscriptions (VSCode teardown) and reuse the same
    // list for the FeatureHandle.dispose() contract.

    const disposables: vscode.Disposable[] = [
        treeView,
        { dispose: () => treeProvider.stop() },
        { dispose: () => presenter.stop() },
        ctx.shared.statusBar,
        { dispose: () => watcher.stop() },
        openSub,
        closeSub,
        activeChangeSub,
        editorFocusSub,
        visibilitySub,
        ...commandSubs,
    ];

    ctx.subscriptions.push(...disposables);

    return {
        dispose() {
            // Drop the cross-module spawner handle so a stale
            // reference can't survive into a future activation cycle
            // (e.g. window reload / extension restart).
            setTerminalSpawner(undefined);
            for (const d of disposables) {
                d.dispose();
            }
        },
    };
}
