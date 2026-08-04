// The one place Superset opens a terminal.
//
// Every entry point — the panel's "new terminal" command, the cross-module
// `terminalSpawner` lease consumed by install commands / mDNS connect / git
// hooks — goes through here, so terminal creation options stay identical no
// matter which feature asks for one.
//
// This is VS Code's own terminal: the shell, its process tree and its
// scrollback are owned by the workbench, and activity detection observes it
// from the outside (process-tree polling plus shell-integration execution
// edges). Superset holds no pseudoterminal of its own.

import * as vscode from "vscode";

/** Open a native VS Code terminal named `name`, rooted at `cwd`. */
export function createNativeTerminal(
    name: string,
    cwd: string
): vscode.Terminal {
    return vscode.window.createTerminal({ name, cwd });
}
