import * as vscode from "vscode";
import { TerminalRegistry } from "./terminalRegistry";
import { OutputWatcher } from "./outputWatcher";
import { TerminalTreeProvider } from "./treeProvider";
import { HighlightPresenter } from "./highlightPresenter";

export function activate(context: vscode.ExtensionContext): void {
    console.log("[superset] activated");

    const registry = new TerminalRegistry();
    const subscriptions: vscode.Disposable[] = [];

    // Pre-populate registry with already-open terminals (e.g., reload window).
    for (const terminal of vscode.window.terminals) {
        registry.add(terminal);
    }

    // Wire TerminalTreeProvider to a TreeView.
    const treeProvider = new TerminalTreeProvider(registry);
    treeProvider.start();
    subscriptions.push({ dispose: () => treeProvider.stop() });

    const treeView = vscode.window.createTreeView(
        "superset.terminals",
        { treeDataProvider: treeProvider }
    );
    // Tag the panel with a short session id so users running multiple
    // VSCode windows can tell which window this dashboard belongs to.
    // sessionId is a per-process UUID; first 8 hex chars are enough to
    // disambiguate on a single machine.
    const windowTag = vscode.env.sessionId.slice(0, 8);
    treeView.message = `Window: ${windowTag}`;
    subscriptions.push(treeView);

    // Wire HighlightPresenter against a status bar item.
    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBar.name = "Superset";
    const presenter = new HighlightPresenter({
        registry,
        setTerminalName: (terminal, name) => {
            // vscode.Terminal.name is settable in 1.85+ but typed readonly;
            // escape via `unknown` to assign at runtime.
            (terminal as unknown as { name: string }).name = name;
        },
        setStatusBarText: (text) => {
            statusBar.text = text;
        },
        showStatusBar: () => statusBar.show(),
        hideStatusBar: () => statusBar.hide(),
    });
    presenter.start();
    subscriptions.push({ dispose: () => presenter.stop() });
    subscriptions.push(statusBar);

    // OutputWatcher: subscribe to Shell Integration events.
    const watcher = new OutputWatcher({
        registry,
        getActiveTerminal: () => vscode.window.activeTerminal,
        onShellExecution: (cb) => {
            const disposable = vscode.window.onDidStartTerminalShellExecution(
                (event) => {
                    cb({
                        terminal: event.terminal,
                        execution: {
                            // TerminalShellExecution exposes `read()` in
                            // @types/vscode 1.85; adapt the AsyncIterable to
                            // the watcher's per-chunk listener contract.
                            onData: (dataCb) => {
                                void (async () => {
                                    for await (const chunk of event.execution.read()) {
                                        dataCb(chunk);
                                    }
                                })();
                            },
                        },
                    });
                }
            );
            return () => disposable.dispose();
        },
    });
    watcher.start();
    subscriptions.push({ dispose: () => watcher.stop() });

    // Lifecycle: open / close / active-change events.
    subscriptions.push(
        vscode.window.onDidOpenTerminal((terminal) => {
            registry.add(terminal);
        })
    );

    subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
            registry.remove(terminal);
        })
    );

    subscriptions.push(
        vscode.window.onDidChangeActiveTerminal((terminal) => {
            // Spec §7: undefined means "all closed" — do not clear flags.
            if (!terminal) {
                return;
            }
            registry.clearUnseen(terminal);
        })
    );

    // Commands.
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.focusView",
            () => {
                vscode.commands.executeCommand(
                    "workbench.view.superset"
                );
            }
        )
    );

    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.focus",
            (terminal: vscode.Terminal | undefined) => {
                if (!terminal) {
                    return;
                }
                // Defensive: if the terminal is gone, refresh the tree so
                // the panel drops the stale entry instead of throwing.
                if (!registry.has(terminal)) {
                    return;
                }
                terminal.show();
            }
        )
    );

    // Close [X] command: kills the terminal process. The downstream
    // `window.onDidCloseTerminal` handler removes it from the registry,
    // so we deliberately do NOT call `registry.remove` here — keeping
    // a single source of truth for the remove event.
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.delete",
            (terminal: vscode.Terminal | undefined) => {
                if (!terminal) {
                    return;
                }
                if (!registry.has(terminal)) {
                    return;
                }
                terminal.dispose();
            }
        )
    );

    for (const d of subscriptions) {
        context.subscriptions.push(d);
    }
}

export function deactivate(): void {
    // Disposables are torn down by VSCode via context.subscriptions.
}
