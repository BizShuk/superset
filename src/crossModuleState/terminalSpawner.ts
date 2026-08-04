// Cross-module bridge: the terminals feature owns how Superset opens a
// terminal, but other features (notably the install commands in
// `globalCommandsPlugin`) need to open one too. We expose a tiny
// setter/getter pair here so:
//
// 1. The terminals feature can publish `createNativeTerminal` as a
//    cross-module handle during `register()`.
// 2. The global-commands plugin can pull the latest setter at command-fire
//    time, ensuring the spawn function is wired before the user can invoke
//    a command.
//
// Why not inject through `SharedDeps`? `SharedDeps` is the legacy
// `FeatureContext` shape that pre-dates the plugin era. The
// `globalCommandsPlugin` already follows the same setter convention via
// `setPluginManager()` / `setDiagnosticChannel()` (see sibling files in
// this directory); we follow the same convention here rather than
// expanding the legacy shape.

import type * as vscode from "vscode";

/** Opens a native `vscode.Terminal` named `name`, rooted at `cwd`. */
export type TerminalSpawner = (name: string, cwd: string) => vscode.Terminal;

let spawner: TerminalSpawner | undefined;

/** Set the active terminal spawner. Called by the terminals feature during
 *  `register()`. Passing `undefined` clears it (used by `deactivate()`). */
export function setTerminalSpawner(next: TerminalSpawner | undefined): void {
    spawner = next;
}

/**
 * Publish one spawner as a lifecycle-bound lease. Disposing an older lease
 * cannot clear a newer activation's spawner.
 */
export function bindTerminalSpawner(
    next: TerminalSpawner
): vscode.Disposable {
    setTerminalSpawner(next);
    let disposed = false;
    return {
        dispose(): void {
            if (disposed) return;
            disposed = true;
            if (spawner === next) {
                setTerminalSpawner(undefined);
            }
        },
    };
}

/** Return the currently-registered spawner, or `undefined` if the
 *  terminals feature has not activated yet. */
export function getTerminalSpawner(): TerminalSpawner | undefined {
    return spawner;
}
