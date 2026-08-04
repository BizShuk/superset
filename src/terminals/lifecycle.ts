// Lifecycle bridges for the terminals feature — extracted from
// `index.ts` as Plan 2 Stage C so the `onDidOpenTerminal` tracking
// logic and the 50-line `onDidChangeActiveTextEditor` tab-focus logic
// can each be reasoned about (and tested) in isolation. Both
// functions return `vscode.Disposable`; the composition root collects
// them into the `disposables` list so a single `dispose()` call tears
// everything down.

import * as vscode from "vscode";
import { shouldTrackTerminal } from "./terminalFilter";
import type { TerminalRegistry } from "./terminalRegistry";
import type { WatchedTerminalTracker } from "./watchedTerminalTracker";

export interface TerminalOpenTrackerDeps {
    registry: TerminalRegistry;
    log: (msg: string) => void;
}

/**
 * Subscribe to `vscode.window.onDidOpenTerminal` and add every
 * user-facing terminal to the registry.
 *
 * Terminals are VS Code's own — Superset observes them, it never
 * replaces or re-creates one. Whoever opened the terminal (the user,
 * another extension, one of Superset's own commands) keeps the shell
 * they asked for, including its location, custom shell path and any
 * pseudoterminal an extension supplied.
 *
 * The single exclusion is agent-owned terminals (e.g. `Antigravity
 * Agent`): silent background workers, not work surfaces, so they never
 * enter the registry and get no row in the panel.
 */
export function installTerminalOpenTracker(
    deps: TerminalOpenTrackerDeps
): vscode.Disposable {
    const { registry, log } = deps;
    return vscode.window.onDidOpenTerminal((terminal) => {
        if (!shouldTrackTerminal(terminal.name)) {
            log(
                `[skip-track] onOpen "${terminal.name}": agent-owned (excluded from panel)`
            );
            return;
        }
        registry.add(terminal);
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