import * as vscode from "vscode";
import * as nodePty from "@homebridge/node-pty-prebuilt-multiarch";
import { TerminalRegistry } from "./terminalRegistry";
import { OutputWatcher } from "./outputWatcher";
import { PtyTerminalHost } from "./ptyTerminalHost";
import type { PtyProcess, PtySpawner } from "./ptyTerminalHost";
import { TerminalTreeProvider } from "./treeProvider";
import { HighlightPresenter } from "./highlightPresenter";
import { stripUnseenPrefix } from "./treeSpec";

export function activate(context: vscode.ExtensionContext): void {
    console.log("[superset] activated");

    const registry = new TerminalRegistry();
    const subscriptions: vscode.Disposable[] = [];

    // Diagnostic channel. We log to BOTH `console.log` (visible in
    // `View → Output → Extension Host` — easy to find) AND a dedicated
    // `Superset` OutputChannel (visible in the channel dropdown) so the
    // log is findable regardless of how the user looks for it.
    const diag = vscode.window.createOutputChannel("Superset");
    const log = (msg: string) => {
        const stamped = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
        console.log(`[superset] ${msg}`);
        diag.appendLine(stamped);
    };
    log(`activate session=${vscode.env.sessionId.slice(0, 8)}`);

    // Pre-populate registry with already-open terminals (e.g., reload window).
    for (const terminal of vscode.window.terminals) {
        registry.add(terminal);
    }
    log(`pre-populated ${vscode.window.terminals.length} terminal(s)`);

    // Wire TerminalTreeProvider to a TreeView.
    const treeProvider = new TerminalTreeProvider(registry);
    treeProvider.start();
    subscriptions.push({ dispose: () => treeProvider.stop() });

    // Diagnostic: log every unseen-changed event to trace the chain.
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
            // vscode.Terminal.name is typed readonly. The cast worked in
            // VSCode 1.85 but newer versions (1.90+) made the runtime
            // property getter-only, so this throws. The presenter catches
            // the throw and degrades to panel + status bar only.
            (terminal as unknown as { name: string }).name = name;
        },
        setStatusBarText: (text) => {
            statusBar.text = text;
        },
        showStatusBar: () => statusBar.show(),
        hideStatusBar: () => statusBar.hide(),
        log,
    });
    presenter.start();
    subscriptions.push({ dispose: () => presenter.stop() });
    subscriptions.push(statusBar);

    // OutputWatcher: subscribe to Shell Integration events.
    const watcher = new OutputWatcher({
        registry,
        getActiveTerminal: () => vscode.window.activeTerminal,
        log,
        onShellExecution: (cb) => {
            const disposable = vscode.window.onDidStartTerminalShellExecution(
                (event) => {
                    log(
                        `shell-exec.start: terminal="${event.terminal.name}" ` +
                            `cmd="${event.execution.commandLine.value.slice(0, 60)}"`
                    );
                    cb({
                        terminal: event.terminal,
                        execution: {
                            // TerminalShellExecution exposes `read()` in
                            // @types/vscode 1.85; adapt the AsyncIterable to
                            // the watcher's per-chunk listener contract.
                            onData: (dataCb) => {
                                log(`shell-exec.onData wired for "${event.terminal.name}"`);
                                void (async () => {
                                    try {
                                        for await (const chunk of event.execution.read()) {
                                            dataCb(chunk);
                                            log(
                                                `shell-exec.chunk ${chunk.length}B ` +
                                                    `for "${event.terminal.name}"`
                                            );
                                        }
                                        log(`shell-exec.stream closed for "${event.terminal.name}"`);
                                    } catch (err) {
                                        log(`shell-exec.ERROR reading "${event.terminal.name}": ${err}`);
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
    log("OutputWatcher started");
    subscriptions.push({ dispose: () => watcher.stop() });

    // PtyTerminalHost factory: spawns real PTY-backed terminals via
    // `vscode.Pseudoterminal` so TUI redraws (`claude`, `vim`, ...) are
    // captured fully. Existing VSCode-built terminals (no pty control)
    // rely on the shell-integration OutputWatcher above and may miss
    // TUI output — users can open a TUI terminal via the new command
    // to get reliable detection.
    const ptySpawner: PtySpawner = (file, args, options) => {
        const proc = nodePty.spawn(file, args, {
            cwd: options.cwd,
            env: options.env as Record<string, string>,
            cols: options.cols,
            rows: options.rows,
        });
        const handle: PtyProcess = {
            onData: (cb) => proc.onData(cb),
            onExit: (cb) =>
                proc.onExit(({ exitCode }) => cb(exitCode ?? 0)),
            write: (data) => proc.write(data),
            kill: () => proc.kill(),
            resize: (cols, rows) => proc.resize(cols, rows),
        };
        return handle;
    };

    function createPtyPseudoterminal(
        host: PtyTerminalHost
    ): vscode.Pseudoterminal {
        return {
            onDidWrite: (listener) => ({
                dispose: host.onWrite((data) => listener(data)),
            }),
            onDidClose: (listener) => ({
                dispose: host.onClose((code) => listener(code)),
            }),
            open: (initialDimensions) => {
                // Pseudoterminal.open declares `dimensions` as possibly
                // undefined; default to 80x24 if the framework doesn't
                // supply them (e.g. legacy VSCode versions).
                host.open({
                    columns: initialDimensions?.columns ?? 80,
                    rows: initialDimensions?.rows ?? 24,
                });
            },
            close: () => host.close(),
            handleInput: (data) => host.handleInput(data),
            setDimensions: (dimensions) =>
                host.setDimensions({
                    columns: dimensions.columns,
                    rows: dimensions.rows,
                }),
        };
    }

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
            log(
                `active-changed: "${terminal?.name ?? "<none>"}"`
            );
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

    // Open the diagnostic OutputChannel so users can find logs without
    // hunting through the Output dropdown.
    subscriptions.push(
        vscode.commands.registerCommand("superset.showLogs", () => {
            diag.show(true);
        })
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

    // Copy Terminal Name: write the bare terminal name to the clipboard.
    // `stripUnseenPrefix` removes the `● ` highlight prefix the presenter
    // may have applied, so users copy the logical name, not the prefixed one.
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.copyName",
            async (terminal: vscode.Terminal | undefined) => {
                if (!terminal) {
                    return;
                }
                if (!registry.has(terminal)) {
                    return;
                }
                const bare = stripUnseenPrefix(terminal.name);
                await vscode.env.clipboard.writeText(bare);
            }
        )
    );

    // Rename Terminal: dispatch VSCode's built-in rename command, which
    // operates only on the active terminal — so we `show()` the target
    // first. The built-in command handles the input box and the actual
    // write to `Terminal.name` (the public API has no public setter:
    // `Terminal.name` is implemented as a getter-only property, so direct
    // assignment throws in strict mode). `executeCommand` resolves after
    // the user commits the new name, so refreshing right after picks up
    // the updated label.
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.rename",
            async (terminal: vscode.Terminal | undefined) => {
                if (!terminal) {
                    return;
                }
                if (!registry.has(terminal)) {
                    return;
                }
                terminal.show();
                await vscode.commands.executeCommand(
                    "workbench.action.terminal.rename"
                );
                treeProvider.refresh();
            }
        )
    );

    // Open a PTY-backed terminal whose host captures every byte the
    // shell produces, including TUI redraws. This is the only way to
    // reliably detect output from full-screen apps (claude, vim, htop)
    // running interactively inside the terminal — shell integration's
    // execution.read() drops TUI-style output.
    //
    // Existing VSCode-built terminals (the ones you get from the + menu)
    // are NOT converted; the user opts in by running this command. The
    // `onDidOpenTerminal` listener above still adds the new terminal to
    // the registry, so it shows up in the panel like any other.
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.openTuiTerminal",
            () => {
                // Deferred ref: the host must provide the Pseudoterminal
                // BEFORE createTerminal returns, but the terminal object
                // doesn't exist until after. The closure lets the host
                // resolve it later when markUnseen needs to fire.
                let terminalRef: vscode.Terminal | undefined;
                const host = new PtyTerminalHost({
                    getTerminal: () => terminalRef,
                    registry,
                    getActiveTerminal: () => vscode.window.activeTerminal,
                    spawn: ptySpawner,
                    shell: process.env.SHELL || "/bin/bash",
                    args: ["-i"],
                    cwd: process.cwd(),
                    env: process.env,
                    log,
                });
                const pty = createPtyPseudoterminal(host);
                terminalRef = vscode.window.createTerminal({
                    name: "Superset TUI",
                    pty,
                });
                terminalRef.show();
                log(`openTuiTerminal: spawned pty-backed terminal`);
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
