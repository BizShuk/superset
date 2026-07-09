// Lifecycle bridges for the terminals feature — extracted from
// `index.ts` as Plan 2 Stage C so the 50-line `onDidOpenTerminal`
// PTY-replace logic and the 50-line `onDidChangeActiveTextEditor`
// tab-focus logic can each be reasoned about (and tested) in
// isolation. Both functions return `vscode.Disposable`; the
// composition root collects them into the `disposables` list so a
// single `dispose()` call tears everything down.

import * as vscode from "vscode";
import { decideAutoReplace, shouldTrackTerminal } from "./autoReplace";
import type { TerminalRegistry } from "./terminalRegistry";
import type { PtyTerminalFactory } from "./ptyTerminalFactory";
import type { WatchedTerminalTracker } from "./watchedTerminalTracker";

export interface AutoPtyReplacerDeps {
    registry: TerminalRegistry;
    ptyFactory: PtyTerminalFactory;
    getCwd: () => string;
    log: (msg: string) => void;
}

/**
 * Subscribe to `vscode.window.onDidOpenTerminal` and auto-replace
 * non-PTY terminals with PTY-backed ones when the auto-replace
 * policy says so. Skips PTY-backed terminals (already wired) and
 * agent-owned terminals (excluded by `shouldTrackTerminal`).
 *
 * The replacement dance is: spawn a fresh PTY-backed terminal via
 * `ptyFactory.spawn`, then dispose the original 150ms later. The
 * delay is the empirical minimum for VSCode to attach the new
 * terminal to the panel before the old one's dispose teardown
 * leaves it dangling.
 */
export function installAutoPtyReplacer(
    deps: AutoPtyReplacerDeps
): vscode.Disposable {
    const { registry, ptyFactory, getCwd, log } = deps;
    return vscode.window.onDidOpenTerminal((terminal) => {
        if (ptyFactory.isPtyBacked(terminal)) {
            registry.add(terminal);
            return;
        }
        // Agent-owned terminals (e.g. Antigravity Agent) are
        // excluded from the panel entirely — they are silent
        // background workers, not work surfaces.
        if (!shouldTrackTerminal(terminal.name)) {
            log(
                `[skip-track] onOpen "${terminal.name}": agent-owned (excluded from panel)`
            );
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
        const pterm = ptyFactory.spawn(terminal.name, getCwd());
        pterm.show();
        setTimeout(() => terminal.dispose(), 150);
    });
}

export interface EditorFocusBridgeDeps<Terminal> {
    tracker: WatchedTerminalTracker<Terminal>;
    registry: TerminalRegistry;
    log: (msg: string) => void;
}

/**
 * Subscribe to `vscode.window.onDidChangeActiveTextEditor` and keep
 * the `WatchedTerminalTracker` in sync with what's actually focused:
 *
 * - When a non-terminal text editor is focused, clear the tracker.
 * - When a terminal tab is focused, restore `activeTerminal` into
 *   the tracker and clear its unseen state.
 * - Otherwise (editor undefined, neither tab nor text), leave the
 *   tracker alone.
 *
 * Returned disposable should be collected by the composition root.
 */
export function installEditorFocusBridge<Terminal extends vscode.Terminal>(
    deps: EditorFocusBridgeDeps<Terminal>
): vscode.Disposable {
    const { tracker, registry, log } = deps;
    return vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor !== undefined) {
            if (tracker.watched !== undefined) {
                log(
                    `[watcher] editor focused — clearing watchedTerminal ` +
                        `was="${tracker.watched.name}"`
                );
                tracker.setWatched(undefined);
            }
            return;
        }

        const activeTabInput =
            vscode.window.tabGroups?.activeTabGroup?.activeTab?.input;
        const isTerminalTab =
            activeTabInput instanceof vscode.TabInputTerminal;

        if (isTerminalTab) {
            const active = vscode.window.activeTerminal as
                | Terminal
                | undefined;
            if (active !== undefined) {
                if (tracker.watched !== active) {
                    log(
                        `[watcher] terminal tab focused — restoring watchedTerminal ` +
                            `to="${active.name}"`
                    );
                    tracker.setWatched(active);
                }
                registry.clearUnseen(active);
            }
        } else {
            if (tracker.watched !== undefined) {
                log(
                    `[watcher] non-terminal editor focused — clearing watchedTerminal ` +
                        `was="${tracker.watched.name}"`
                );
                tracker.setWatched(undefined);
            }
        }
    });
}