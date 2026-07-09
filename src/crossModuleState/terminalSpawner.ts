// Cross-module bridge: the terminals feature owns the PTY-backed terminal
// factory, but other features (notably the install commands in
// `globalCommandsPlugin`) need a way to spawn a fresh PTY-backed terminal
// without re-implementing the factory. We expose a tiny setter/getter pair
// here so:
//
// 1. The terminals feature can publish its `ptyFactory.spawn` as a
//    cross-module handle once it's constructed (in `register()`).
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

/** A `vscode.Terminal` factory bound to a PTY-backed host. */
export type TerminalSpawner = (name: string, cwd: string) => vscode.Terminal;

let spawner: TerminalSpawner | undefined;

/** Set the active terminal spawner. Called by the terminals feature after
 *  its `PtyTerminalFactory` is constructed. Passing `undefined` clears it
 *  (used by `deactivate()`). */
export function setTerminalSpawner(next: TerminalSpawner | undefined): void {
    spawner = next;
}

/** Return the currently-registered spawner, or `undefined` if the
 *  terminals feature has not activated yet. */
export function getTerminalSpawner(): TerminalSpawner | undefined {
    return spawner;
}