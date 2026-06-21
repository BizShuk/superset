import * as vscode from "vscode";
import * as nodePty from "@homebridge/node-pty-prebuilt-multiarch";
import { TerminalRegistry } from "./terminalRegistry";
import { OutputWatcher } from "./outputWatcher";
import { PtyTerminalHost } from "./ptyTerminalHost";
import type { PtyProcess, PtySpawner } from "./ptyTerminalHost";
import { TerminalTreeProvider } from "./treeProvider";
import { HighlightPresenter } from "./highlightPresenter";
import { stripUnseenPrefix } from "./treeSpec";
import { decideAutoReplace } from "./autoReplace";

export function activate(context: vscode.ExtensionContext): void {
    console.log("[superset] activated");

    const registry = new TerminalRegistry();
    const subscriptions: vscode.Disposable[] = [];

    // PTY-backed terminals created by this extension. onDidOpenTerminal uses
    // this to skip auto-replacement for terminals we already own.
    const ptyBackedTerminals = new Set<vscode.Terminal>();

    // Reliable "is the user watching this terminal?" source of truth.
    // vscode.window.activeTerminal can remain stale (still pointing at a
    // terminal) after the user clicks into an editor, and
    // onDidChangeActiveTerminal does NOT reliably fire undefined in that case.
    // We therefore drive this ref from BOTH onDidChangeActiveTerminal (terminal
    // gained focus) AND onDidChangeActiveTextEditor (editor gained focus →
    // clear to undefined). PtyTerminalHost / OutputWatcher read it via
    // getActiveTerminal(); keeping it accurate is what makes markUnseen fire
    // once the user has left the terminal.
    let watchedTerminal: vscode.Terminal | undefined =
        vscode.window.activeTerminal;

    // Track when each terminal was last watched/focused, so we can ignore trailing focus-loss output.
    const lastActiveTime = new Map<vscode.Terminal, number>();

    function setWatchedTerminal(newVal: vscode.Terminal | undefined) {
        if (watchedTerminal !== newVal) {
            if (watchedTerminal !== undefined) {
                lastActiveTime.set(watchedTerminal, Date.now());
            }
            watchedTerminal = newVal;
        }
    }

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
        getActiveTerminal: () => watchedTerminal,
        isRecentlyActive: (terminal) => {
            const t = lastActiveTime.get(terminal as vscode.Terminal);
            return t !== undefined && Date.now() - t < 250;
        },
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
                                                    `for "${event.terminal.name}": ` +
                                                    `data=${JSON.stringify(chunk)}`
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
            if (ptyBackedTerminals.has(terminal)) {
                // Terminal we spawned — add to registry and let PtyTerminalHost
                // handle TUI detection via node-pty onData.
                registry.add(terminal);
                return;
            }
            // Decide whether this terminal is a "plain panel terminal" we can
            // faithfully reproduce. Terminals with a custom location (editor
            // area / split), custom shell, hidden flag, an existing pty, or an
            // agent-owned name are left untouched — disposing-and-cloning them
            // loses options we cannot read back (the editor-area-relocation
            // and Antigravity-breakage bugs). Those fall back to OutputWatcher.
            //
            // Diagnostic: log the raw creationOptions so a repro can confirm
            // whether `location` is actually populated for editor-area
            // terminals (the one field whose presence we cannot verify
            // without a real VSCode instance).
            const opts = (terminal.creationOptions ?? {}) as Record<
                string,
                unknown
            >;
            log(
                `[auto-pty] onOpen "${terminal.name}" ` +
                    `creationOptions=${JSON.stringify({
                        location: opts.location,
                        shellPath: opts.shellPath,
                        shellArgs: opts.shellArgs,
                        hideFromUser: opts.hideFromUser,
                        hasPty: Boolean(opts.pty),
                    })}`
            );
            const decision = decideAutoReplace(
                {
                    location: opts.location,
                    shellPath: opts.shellPath as string | undefined,
                    shellArgs: opts.shellArgs as string | string[] | undefined,
                    hideFromUser: opts.hideFromUser as boolean | undefined,
                    pty: opts.pty,
                },
                terminal.name
            );
            if (!decision.replace) {
                log(
                    `[auto-pty] skip "${terminal.name}": ${decision.reason} ` +
                        `(OutputWatcher fallback)`
                );
                registry.add(terminal);
                return;
            }

            // Plain panel terminal — auto-replace with a PTY-backed terminal
            // so TUI apps are detectable without requiring proposed APIs.
            log(
                `[auto-pty] replacing "${terminal.name}" ` +
                    `(${decision.reason}) with PTY-backed terminal`
            );
            const cwd =
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
                process.cwd();
            const pterm = spawnPtyTerminal(terminal.name, cwd);
            pterm.show();
            // Defer dispose: give the PTY terminal's onDidOpenTerminal a tick
            // to fire first so the panel never shows zero terminals.
            setTimeout(() => terminal.dispose(), 150);
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
            // Update watchedTerminal. Editor-focus is handled separately by
            // onDidChangeActiveTextEditor below, since this event does not
            // reliably fire when focus moves from a terminal to an editor.
            setWatchedTerminal(terminal);
            // Spec §7: undefined means no terminal focused — do not clear flags.
            if (!terminal) {
                return;
            }
            registry.clearUnseen(terminal);
        })
    );

    // VSCode does NOT reliably fire onDidChangeActiveTerminal(undefined) when
    // the user switches from a terminal to an editor tab — activeTerminal can
    // remain stale, causing detectActivity to skip markUnseen indefinitely.
    // Clearing watchedTerminal on any editor-focus event ensures the guard
    // `active === terminal` is false while the user is not in the terminal.
    subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor !== undefined) {
                // A text editor gained focus -> clear watchedTerminal.
                if (watchedTerminal !== undefined) {
                    log(
                        `[watcher] editor focused — clearing watchedTerminal ` +
                            `was="${watchedTerminal.name}"`
                    );
                    setWatchedTerminal(undefined);
                }
                return;
            }

            // activeTextEditor is undefined. This could mean a terminal tab, a webview,
            // or another non-text editor gained focus.
            // Check if the currently active tab is a terminal tab in the editor group.
            const activeTabInput = vscode.window.tabGroups?.activeTabGroup?.activeTab?.input;
            const isTerminalTab = activeTabInput instanceof vscode.TabInputTerminal;

            if (isTerminalTab) {
                // The user focused a terminal tab in the editor area!
                // Restore watchedTerminal to activeTerminal if it was cleared.
                if (vscode.window.activeTerminal !== undefined) {
                    if (watchedTerminal !== vscode.window.activeTerminal) {
                        log(
                            `[watcher] terminal tab focused — restoring watchedTerminal ` +
                                `to="${vscode.window.activeTerminal.name}"`
                        );
                        setWatchedTerminal(vscode.window.activeTerminal);
                    }
                    registry.clearUnseen(vscode.window.activeTerminal);
                }
            } else {
                // Focus moved to a non-terminal tab (e.g. webview, settings, etc.) -> clear watchedTerminal.
                if (watchedTerminal !== undefined) {
                    log(
                        `[watcher] non-terminal editor focused — clearing watchedTerminal ` +
                            `was="${watchedTerminal.name}"`
                    );
                    setWatchedTerminal(undefined);
                }
            }
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

    // Spawn a PTY-backed terminal. Every byte from the shell goes through
    // node-pty, so TUI redraws (claude, vim, htop) are captured in full.
    // The returned terminal is pre-registered in ptyBackedTerminals so that
    // the onDidOpenTerminal handler knows NOT to replace it again.
    function spawnPtyTerminal(name: string, cwd: string): vscode.Terminal {
        let terminalRef: vscode.Terminal | undefined;
        const host = new PtyTerminalHost({
            getTerminal: () => terminalRef,
            registry,
            getActiveTerminal: () => watchedTerminal,
            isRecentlyActive: (terminal) => {
                const t = lastActiveTime.get(terminal as vscode.Terminal);
                return t !== undefined && Date.now() - t < 250;
            },
            spawn: ptySpawner,
            shell: process.env.SHELL || "/bin/bash",
            args: ["-i"],
            cwd,
            env: process.env,
            log,
        });
        const pty = createPtyPseudoterminal(host);
        terminalRef = vscode.window.createTerminal({ name, pty });
        ptyBackedTerminals.add(terminalRef);
        log(`spawnPtyTerminal: "${name}" cwd=${cwd}`);
        return terminalRef;
    }

    // Legacy command kept for backwards compatibility / keybinding.
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.openTuiTerminal",
            () => {
                const cwd =
                    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
                    process.cwd();
                spawnPtyTerminal("Superset TUI", cwd).show();
            }
        )
    );

    // Primary "new terminal" command. Registered so users can bind it and
    // so the toolbar button in package.json points here.
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.newTerminal",
            () => {
                const cwd =
                    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
                    process.cwd();
                spawnPtyTerminal("bash", cwd).show();
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
