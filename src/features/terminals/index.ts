import * as vscode from "vscode";
import * as nodePty from "@homebridge/node-pty-prebuilt-multiarch";
import type { FeatureContext, FeatureHandle } from "../../types";
import type { PtyProcess, PtySpawner } from "../../ptyTerminalHost";
import { TerminalRegistry } from "../../terminalRegistry";
import { OutputWatcher } from "../../outputWatcher";
import { PtyTerminalHost } from "../../ptyTerminalHost";
import { TerminalTreeProvider, isGroup } from "../../treeProvider";
import { HighlightPresenter } from "../../highlightPresenter";
import { stripUnseenPrefix } from "../../treeSpec";
import { decideAutoReplace } from "../../autoReplace";
import {
    GroupStore,
    UNGROUPED_ID,
    type Group,
    type GroupColor,
} from "../../groupStore";

export function register(ctx: FeatureContext): FeatureHandle {
    const log = ctx.shared.log;
    const registry = new TerminalRegistry();
    const groupStore = new GroupStore();

    // PTY-backed terminals created by this extension.
    const ptyBackedTerminals = new Set<vscode.Terminal>();

    // "Is the user watching this terminal?" source of truth.
    let watchedTerminal: vscode.Terminal | undefined =
        vscode.window.activeTerminal;

    // Track when each terminal was last watched/focused.
    const lastActiveTime = new Map<vscode.Terminal, number>();

    function setWatchedTerminal(newVal: vscode.Terminal | undefined) {
        if (watchedTerminal !== newVal) {
            if (watchedTerminal !== undefined) {
                lastActiveTime.set(watchedTerminal, Date.now());
            }
            watchedTerminal = newVal;
        }
    }

    // Pre-populate registry and group store with already-open terminals.
    for (const terminal of vscode.window.terminals) {
        registry.add(terminal);
        groupStore.assignDefaultGroup(terminal);
    }
    log(`pre-populated ${vscode.window.terminals.length} terminal(s)`);

    // Wire TerminalTreeProvider to a TreeView.
    const treeProvider = new TerminalTreeProvider(registry, groupStore);
    treeProvider.start();

    // Diagnostic: log every unseen-changed event.
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
        Group | vscode.Terminal
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
                            id: (item as Group).id,
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
                    terminal?: vscode.Terminal;
                };
                if (value.kind === "terminal" && value.terminal) {
                    const targetGroupId = isGroup(target)
                        ? (target as Group).id
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
    const windowTag = vscode.env.sessionId.slice(0, 8);
    treeView.message = `Window: ${windowTag}`;

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

    // PtyTerminalHost factory.
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

    // Spawn a PTY-backed terminal.
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

    // ── Lifecycle subscriptions ──────────────────────────

    const openSub = vscode.window.onDidOpenTerminal((terminal) => {
        if (ptyBackedTerminals.has(terminal)) {
            registry.add(terminal);
            return;
        }
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

        log(
            `[auto-pty] replacing "${terminal.name}" ` +
                `(${decision.reason}) with PTY-backed terminal`
        );
        const cwd =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
            process.cwd();
        const pterm = spawnPtyTerminal(terminal.name, cwd);
        pterm.show();
        setTimeout(() => terminal.dispose(), 150);
    });

    const closeSub = vscode.window.onDidCloseTerminal((terminal) => {
        registry.remove(terminal);
    });

    const activeChangeSub = vscode.window.onDidChangeActiveTerminal((terminal) => {
        log(`active-changed: "${terminal?.name ?? "<none>"}"`);
        setWatchedTerminal(terminal);
        if (!terminal) {
            return;
        }
        registry.clearUnseen(terminal);
    });

    const editorFocusSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor !== undefined) {
            if (watchedTerminal !== undefined) {
                log(
                    `[watcher] editor focused — clearing watchedTerminal ` +
                        `was="${watchedTerminal.name}"`
                );
                setWatchedTerminal(undefined);
            }
            return;
        }

        const activeTabInput = vscode.window.tabGroups?.activeTabGroup?.activeTab?.input;
        const isTerminalTab = activeTabInput instanceof vscode.TabInputTerminal;

        if (isTerminalTab) {
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
            if (watchedTerminal !== undefined) {
                log(
                    `[watcher] non-terminal editor focused — clearing watchedTerminal ` +
                        `was="${watchedTerminal.name}"`
                );
                setWatchedTerminal(undefined);
            }
        }
    });

    // ── Commands ─────────────────────────────────────────

    const focusCmd = vscode.commands.registerCommand(
        "superset.focus",
        (terminal: vscode.Terminal | undefined) => {
            if (!terminal) return;
            if (!registry.has(terminal)) return;
            terminal.show();
        }
    );

    const deleteCmd = vscode.commands.registerCommand(
        "superset.delete",
        (terminal: vscode.Terminal | undefined) => {
            if (!terminal) return;
            if (!registry.has(terminal)) return;
            terminal.dispose();
        }
    );

    const copyNameCmd = vscode.commands.registerCommand(
        "superset.copyName",
        async (terminal: vscode.Terminal | undefined) => {
            if (!terminal) return;
            if (!registry.has(terminal)) return;
            const bare = stripUnseenPrefix(terminal.name);
            await vscode.env.clipboard.writeText(bare);
        }
    );

    const renameCmd = vscode.commands.registerCommand(
        "superset.rename",
        async (terminal: vscode.Terminal | undefined) => {
            if (!terminal) return;
            if (!registry.has(terminal)) return;
            terminal.show();
            await vscode.commands.executeCommand(
                "workbench.action.terminal.rename"
            );
            treeProvider.refresh();
        }
    );

    // Group commands.
    const newGroupCmd = vscode.commands.registerCommand(
        "superset.newGroup",
        async () => {
            const name = await vscode.window.showInputBox({
                prompt: "群組名稱",
                value: "",
            });
            if (!name) return;
            groupStore.createGroup(name);
        }
    );

    const renameGroupCmd = vscode.commands.registerCommand(
        "superset.renameGroup",
        async (group: Group | undefined) => {
            if (!group) return;
            const name = await vscode.window.showInputBox({
                prompt: "新名稱",
                value: group.name,
            });
            if (!name) return;
            groupStore.renameGroup(group.id, name);
        }
    );

    const setGroupColorCmd = vscode.commands.registerCommand(
        "superset.setGroupColor",
        async (group: Group | undefined) => {
            if (!group) return;
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
            if (!color) return;
            groupStore.setGroupColor(group.id, color as GroupColor);
        }
    );

    const deleteGroupCmd = vscode.commands.registerCommand(
        "superset.deleteGroup",
        (group: Group | undefined) => {
            if (!group || group.id === UNGROUPED_ID) return;
            groupStore.deleteGroup(group.id);
        }
    );

    const toggleGroupCollapseCmd = vscode.commands.registerCommand(
        "superset.toggleGroupCollapsed",
        (group: Group | undefined) => {
            if (!group) return;
            groupStore.toggleGroupCollapsed(group.id);
        }
    );

    const openTuiCmd = vscode.commands.registerCommand(
        "superset.openTuiTerminal",
        () => {
            const cwd =
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
                process.cwd();
            spawnPtyTerminal("Superset TUI", cwd).show();
        }
    );

    const newTerminalCmd = vscode.commands.registerCommand(
        "superset.newTerminal",
        () => {
            const cwd =
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
                process.cwd();
            spawnPtyTerminal("bash", cwd).show();
        }
    );

    // ── Register disposables ─────────────────────────────

    ctx.subscriptions.push(
        treeView,
        { dispose: () => treeProvider.stop() },
        { dispose: () => presenter.stop() },
        ctx.shared.statusBar,
        { dispose: () => watcher.stop() },
        openSub,
        closeSub,
        activeChangeSub,
        editorFocusSub,
        focusCmd,
        deleteCmd,
        copyNameCmd,
        renameCmd,
        newGroupCmd,
        renameGroupCmd,
        setGroupColorCmd,
        deleteGroupCmd,
        toggleGroupCollapseCmd,
        openTuiCmd,
        newTerminalCmd,
    );

    return {
        dispose() {
            treeProvider.stop();
            presenter.stop();
            watcher.stop();
            treeView.dispose();
            openSub.dispose();
            closeSub.dispose();
            activeChangeSub.dispose();
            editorFocusSub.dispose();
            focusCmd.dispose();
            deleteCmd.dispose();
            copyNameCmd.dispose();
            renameCmd.dispose();
            newGroupCmd.dispose();
            renameGroupCmd.dispose();
            setGroupColorCmd.dispose();
            deleteGroupCmd.dispose();
            toggleGroupCollapseCmd.dispose();
            openTuiCmd.dispose();
            newTerminalCmd.dispose();
        },
    };
}
