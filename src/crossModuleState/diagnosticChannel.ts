// Diagnostic OutputChannel handle — published by `extension.ts` after the
// root creates it, so feature modules (e.g. `globalCommandsPlugin`'s
// `showLogs` / `spawnRunTerminal` catch path) can route their own log
// lines into the same channel. Module-level mutable state is a known
// anti-pattern but acceptable here while `PluginContext.diag` is not
// yet part of the contract (see `2026-07-08-chore-consistency-redundancy-
// scalability.md` §Stage 6 for the long-term DI migration).

import type * as vscode from "vscode";

let diagnosticChannel: vscode.OutputChannel | undefined;

/** Set the active diagnostic channel. Called once by `extension.ts`. */
export function setDiagnosticChannel(
    channel: vscode.OutputChannel
): void {
    diagnosticChannel = channel;
}

/** Return the currently-registered channel, or `undefined` if the
 *  extension has not activated yet. */
export function getDiagnosticChannel(): vscode.OutputChannel | undefined {
    return diagnosticChannel;
}