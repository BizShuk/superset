import * as vscode from "vscode";
import * as nodePty from "@homebridge/node-pty-prebuilt-multiarch";
import { TerminalRegistry } from "./terminalRegistry";
import { OutputWatcher } from "./outputWatcher";
import { PtyTerminalHost } from "./ptyTerminalHost";
import type { PtyProcess, PtySpawner } from "./ptyTerminalHost";
import { TerminalTreeProvider, isGroup } from "./treeProvider";
import { HighlightPresenter } from "./highlightPresenter";
import { stripUnseenPrefix } from "./treeSpec";
import { decideAutoReplace } from "./autoReplace";
import { ExplorerStore } from "./explorerStore";
import { VscodeFsAdapter } from "./fsAdapter";
import { ExplorerTreeProvider } from "./explorerTreeProvider";
import { MdnsRegistry } from "./mdnsRegistry";
import { MulticastDnsTransport } from "./mdnsTransport";
import { MdnsTreeProvider, type MdnsDetail } from "./mdnsTreeProvider";
import { TopologyStore } from "./topologyStore";
import { NodeTopologyScanner } from "./topologyScanner";
import { TopologyTreeProvider } from "./topologyTreeProvider";
import { TodoTreeProvider } from "./todoTreeProvider";
import { TodoStore } from "./todoStore";
import {
    GroupStore,
    UNGROUPED_ID,
    type Group,
    type GroupColor,
} from "./groupStore";
import type { MdnsService, TerminalHandle } from "./types";

export function activate(context: vscode.ExtensionContext): void {
    console.log("[superset] activated");

    const registry = new TerminalRegistry();
    const groupStore = new GroupStore();
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

    // Pre-populate registry and group store with already-open terminals.
    for (const terminal of vscode.window.terminals) {
        registry.add(terminal);
        groupStore.assignDefaultGroup(terminal);
    }
    log(`pre-populated ${vscode.window.terminals.length} terminal(s)`);

    // Wire TerminalTreeProvider to a TreeView.
    const treeProvider = new TerminalTreeProvider(registry, groupStore);
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

    // Drag-and-drop: terminals move between groups; groups reorder.
    const dragAndDropController: vscode.TreeDragAndDropController<
        Group | TerminalHandle
    > = {
        dragMimeTypes: [
            "application/vnd.code.tree.superset.terminals/dnd",
        ],
        dropMimeTypes: [
            "application/vnd.code.tree.superset.terminals/dnd",
        ],
        handleDrag: (source, dataTransfer) => {
            for (const item of source) {
                if (isGroup(item)) {
                    dataTransfer.set(
                        "application/vnd.code.tree.superset.terminals/dnd",
                        new vscode.DataTransferItem({
                            kind: "group",
                            id: item.id,
                        })
                    );
                } else {
                    dataTransfer.set(
                        "application/vnd.code.tree.superset.terminals/dnd",
                        new vscode.DataTransferItem({
                            kind: "terminal",
                            terminal: item,
                        })
                    );
                }
            }
        },
        handleDrop: (target, dataTransfer) => {
            const dropped: vscode.DataTransferItem[] = [];
            dataTransfer.forEach((item) => dropped.push(item));
            for (const item of dropped) {
                const value = item.value as {
                    kind: "group" | "terminal";
                    id?: string;
                    terminal?: TerminalHandle;
                };
                if (value.kind === "terminal" && value.terminal) {
                    const targetGroupId = isGroup(target)
                        ? target.id
                        : UNGROUPED_ID;
                    groupStore.moveTerminalToGroup(
                        value.terminal,
                        targetGroupId
                    );
                } else if (value.kind === "group" && value.id) {
                    groupStore.moveGroup(
                        value.id,
                        groupStore.getGroups().length - 1
                    );
                }
            }
            treeProvider.refresh();
        },
    };

    const treeView = vscode.window.createTreeView(
        "superset.terminals",
        {
            treeDataProvider: treeProvider,
            dragAndDropController,
            showCollapseAll: true,
        }
    );
    // Tag the panel with a short session id so users running multiple
    // VSCode windows can tell which window this dashboard belongs to.
    // sessionId is a per-process UUID; first 8 hex chars are enough to
    // disambiguate on a single machine.
    const windowTag = vscode.env.sessionId.slice(0, 8);
    treeView.message = `Window: ${windowTag}`;
    subscriptions.push(treeView);

    // ── Explorer TreeView ─────────────────────────────────
    const explorerStore = new ExplorerStore(new VscodeFsAdapter());
    explorerStore.start();
    const explorerProvider = new ExplorerTreeProvider(explorerStore);
    explorerProvider.start();
    subscriptions.push({ dispose: () => explorerProvider.stop() });
    subscriptions.push({ dispose: () => explorerStore.stop() });

    const explorerView = vscode.window.createTreeView("superset.explore", {
        treeDataProvider: explorerProvider,
        showCollapseAll: true,
    });
    subscriptions.push(explorerView);

    // ── mDNS TreeView ─────────────────────────────────────
    const mdnsRegistry = new MdnsRegistry(new MulticastDnsTransport());
    mdnsRegistry.start();
    const mdnsProvider = new MdnsTreeProvider(mdnsRegistry);
    mdnsProvider.start();
    subscriptions.push({ dispose: () => mdnsProvider.stop() });
    subscriptions.push({ dispose: () => mdnsRegistry.stop() });

    const mdnsView = vscode.window.createTreeView("superset.mdns", {
        treeDataProvider: mdnsProvider,
        showCollapseAll: true,
    });
    subscriptions.push(mdnsView);

    // ── Topology TreeView ─────────────────────────────────
    const topologyStore = new TopologyStore(new NodeTopologyScanner());
    const topologyProvider = new TopologyTreeProvider(topologyStore);
    topologyProvider.start();
    subscriptions.push({ dispose: () => topologyProvider.stop() });

    const topologyView = vscode.window.createTreeView("superset.topology", {
        treeDataProvider: topologyProvider,
        showCollapseAll: true,
    });
    subscriptions.push(topologyView);

    // ── TODO TreeView ─────────────────────────────────────
    const TODO_VIEW_TITLE = "TODO";
    const workspaceFolder =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const todoStore = new TodoStore(workspaceFolder);
    const todoProvider = new TodoTreeProvider(todoStore);
    todoProvider.start();
    subscriptions.push({ dispose: () => todoProvider.stop() });

    const todoView = vscode.window.createTreeView("superset.todo", {
        treeDataProvider: todoProvider,
        showCollapseAll: true,
    });
    // Context key + TreeView title reflect the current filter state.
    // The menu toolbar uses `when: "superset.todo.filtering == true"`
    // / `!= true` to swap which filter button is shown — see
    // package.json's menus.view/title. setContext must run once at
    // startup so the menu's first render sees the right value
    // (default is "show all", so filtering=false).
    const updateTodoFilterBadge = (filtering: boolean, hidden: number) => {
        // vscode.commands.executeCommand('setContext', ...) is the
        // supported way to push a value into the when-clause engine.
        void vscode.commands.executeCommand(
            "setContext",
            "superset.todo.filtering",
            filtering
        );
        todoView.title = filtering
            ? `${TODO_VIEW_TITLE}  (已隱藏 ${hidden} 個已完成)`
            : TODO_VIEW_TITLE;
    };
    const refreshTodoFilterBadge = () => {
        const filtering = !todoProvider.isShowingCompleted();
        const total = todoStore.getCompletedCount();
        // When filter is ON we hide the "fully completed" subtree, so
        // the reported hidden count is approximate: it's the number of
        // top-level items whose checkbox+descendants are all checked
        // (a conservative upper bound — non-checkbox items don't
        // count). We compute it by asking the provider for the full
        // list under showCompleted=true and comparing to the
        // showCompleted=false list length.
        if (!filtering) {
            updateTodoFilterBadge(false, 0);
            return;
        }
        const all = todoProvider.getChildren() as
            | { line: number; text: string; kind: "checkbox" | "list"; checked: boolean; children?: unknown[] }[]
            | undefined;
        const shown = all?.length ?? 0;
        const totalTop = todoStore.getItems().length;
        const hidden = Math.max(0, totalTop - shown);
        updateTodoFilterBadge(true, hidden);
    };
    // Push initial state so the menu's first render is correct.
    refreshTodoFilterBadge();
    subscriptions.push(todoView);

    // Load initial data; re-load on README.todo file changes
    todoStore.load();
    const todoFileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, "README.todo")
    );
    const onTodoFileChanged = () => {
        todoStore.load().then(() => refreshTodoFilterBadge());
    };
    todoFileWatcher.onDidChange(onTodoFileChanged);
    todoFileWatcher.onDidCreate(onTodoFileChanged);
    subscriptions.push(todoFileWatcher);

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
        // Make the notification clickable. While the item is shown
        // (>=1 unseen terminal), a click jumps to the Superset
        // dashboard. When the presenter hides the item, the command is
        // cleared so a hidden status bar entry never advertises a
        // stale click target. The command ID is owned by this file
        // (not the presenter) so the presenter stays wiring-free.
        setStatusBarCommand: () => {
            statusBar.command = "superset.focusView";
        },
        clearStatusBarCommand: () => {
            statusBar.command = undefined;
        },
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

    // ── Group commands ────────────────────────────────────

    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.newGroup",
            async () => {
                const name = await vscode.window.showInputBox({
                    prompt: "群組名稱",
                    value: "",
                });
                if (!name) {
                    return;
                }
                groupStore.createGroup(name);
            }
        )
    );

    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.renameGroup",
            async (group: Group | undefined) => {
                if (!group) {
                    return;
                }
                const name = await vscode.window.showInputBox({
                    prompt: "新名稱",
                    value: group.name,
                });
                if (!name) {
                    return;
                }
                groupStore.renameGroup(group.id, name);
            }
        )
    );

    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.setGroupColor",
            async (group: Group | undefined) => {
                if (!group) {
                    return;
                }
                const color = await vscode.window.showQuickPick(
                    [
                        "red",
                        "orange",
                        "yellow",
                        "green",
                        "blue",
                        "purple",
                        "magenta",
                        "gray",
                    ] as GroupColor[],
                    { placeHolder: "選擇顏色" }
                );
                if (!color) {
                    return;
                }
                groupStore.setGroupColor(group.id, color as GroupColor);
            }
        )
    );

    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.deleteGroup",
            (group: Group | undefined) => {
                if (!group || group.id === UNGROUPED_ID) {
                    return;
                }
                groupStore.deleteGroup(group.id);
            }
        )
    );

    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.toggleGroupCollapsed",
            (group: Group | undefined) => {
                if (!group) {
                    return;
                }
                groupStore.toggleGroupCollapsed(group.id);
            }
        )
    );

    // ── Explorer commands ─────────────────────────────────
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.exploreRefresh",
            () => {
                explorerStore.refreshAll();
                explorerProvider.refresh();
            }
        )
    );

    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.exploreOpen",
            async (node: { uri: string; isDirectory: boolean } | undefined) => {
                if (!node || node.isDirectory) return;
                const uri = vscode.Uri.file(node.uri);
                await vscode.commands.executeCommand("vscode.open", uri);
            }
        )
    );

    // ── mDNS commands ─────────────────────────────────────
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.mdnsRefresh",
            () => {
                mdnsRegistry.refresh();
                mdnsProvider.refresh();
            }
        )
    );

    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.mdnsCopy",
            async (svc: MdnsService | undefined) => {
                if (!svc) return;
                const target = svc.host ?? svc.addresses[0];
                if (target) {
                    const text =
                        svc.port > 0 ? `${target}:${svc.port}` : target;
                    await vscode.env.clipboard.writeText(text);
                    vscode.window.showInformationMessage(`已複製 ${text}`);
                }
            }
        )
    );

    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.mdnsCopyDetail",
            async (detail: MdnsDetail | undefined) => {
                if (!detail) return;
                await vscode.env.clipboard.writeText(detail.value);
                vscode.window.showInformationMessage(
                    `已複製 ${detail.value}`
                );
            }
        )
    );

    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.mdnsShowDetail",
            async (svc: MdnsService | undefined) => {
                if (!svc) return;
                const lines: string[] = [
                    `名稱: ${svc.name}`,
                    `類型: ${svc.type}`,
                    `網域: ${svc.domain}`,
                    `主機: ${svc.host ?? "(無)"}`,
                    `埠號: ${svc.port}`,
                    `位址: ${svc.addresses.length > 0 ? svc.addresses.join(", ") : "(無)"}`,
                ];
                if (svc.priority > 0 || svc.weight > 0) {
                    lines.push(
                        `優先級: ${svc.priority}  權重: ${svc.weight}`
                    );
                }
                if (svc.ttl > 0) {
                    lines.push(`TTL: ${svc.ttl} 秒`);
                }
                if (svc.subtypes.length > 0) {
                    lines.push(`子類型: ${svc.subtypes.join(", ")}`);
                }
                if (svc.srcAddress) {
                    lines.push(`來源網卡: ${svc.srcAddress}`);
                }
                if (Object.keys(svc.txt).length > 0) {
                    lines.push(
                        `TXT 屬性: ${Object.entries(svc.txt)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(", ")}`
                    );
                }
                lines.push(
                    `首次發現: ${new Date(svc.firstSeen).toLocaleTimeString()}`,
                    `最後更新: ${new Date(svc.lastSeen).toLocaleTimeString()}`
                );
                const detail = lines.join("\n");

                const copyText = svc.host ?? svc.addresses[0];
                const action = await vscode.window.showInformationMessage(
                    detail,
                    { modal: true },
                    "複製位址"
                );
                if (action === "複製位址" && copyText) {
                    const text =
                        svc.port > 0
                            ? `${copyText}:${svc.port}`
                            : copyText;
                    await vscode.env.clipboard.writeText(text);
                    vscode.window.showInformationMessage(`已複製 ${text}`);
                }
            }
        )
    );

    // ── Topology commands ─────────────────────────────────
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.topologyScan",
            async () => {
                vscode.window.showInformationMessage("掃描網路拓撲中...");
                await topologyStore.scan();
                topologyProvider.refresh();
                vscode.window.showInformationMessage("網路拓撲掃描完成");
            }
        )
    );

    // ── Panel navigation ──────────────────────────────────
    const panelOrder = [
        "superset.terminals",
        "superset.explore",
        "superset.mdns",
        "superset.topology",
    ];

    subscriptions.push(
        vscode.commands.registerCommand("superset.focusPanel", async () => {
            const current = vscode.window.activeTextEditor;
            // Find which view container panel currently has visible focus
            // Strategy: cycle through views; focus the next one
            const allViews = panelOrder;
            // Try to focus the first panel — each call cycles
            // Simple approach: focus the superset view container
            await vscode.commands.executeCommand(
                "workbench.view.extension.superset"
            );
            // The view container now has focus; get the current visible view
            // We cycle by trying to focus each view in order
            for (const viewId of allViews) {
                try {
                    await vscode.commands.executeCommand(
                        `${viewId}.focus`
                    );
                    break;
                } catch {
                    // View might not be visible, try next
                }
            }
        })
        );

    // ── TODO commands ─────────────────────────────────────
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.todoToggle",
            async (item: { line: number; checked: boolean; text: string; kind: "checkbox" | "list" } | undefined) => {
                if (!item) return;
                // List-only nodes are not actionable — clicking them
                // in the tree is wired to no command, but guard here
                // so a future caller can't accidentally toggle a
                // line that has no `[ ]` marker in the file.
                if (item.kind === "list") return;
                await todoStore.toggle(item);
            }
        )
    );

    // Two commands + one shared handler: the menu shows whichever
    // button reflects the *opposite* of the current state (i.e. when
    // filtering is off, the "Hide Completed" button is shown, and
    // vice versa). package.json uses `superset.todo.filtering` to
    // swap the visible button.
    const applyFilterToggle = () => {
        todoProvider.toggleShowCompleted();
        refreshTodoFilterBadge();
    };
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.todoFilterHideCompleted",
            applyFilterToggle
        )
    );
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.todoFilterShowAll",
            applyFilterToggle
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
