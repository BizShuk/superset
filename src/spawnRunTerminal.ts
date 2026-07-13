// spawnRunTerminal — opens a fresh PTY-backed terminal and runs a
// command in it. Used by the install commands (installDefaultTools,
// skillInstall, installIgnoreTemplate) and anything else that needs
// to dispatch work to a user-visible terminal without blocking the
// command caller.
//
// Moved out of `globalCommandsPlugin.ts` as Plan 2 Stage B — keeps
// the chrome-commands file focused on view/log/panel orchestration.

import * as os from "node:os";
import * as vscode from "vscode";
import { getDiagnosticChannel, getTerminalSpawner } from "./crossModuleState";

export interface SpawnRunTerminalOptions {
    /** When `true` and the command exits 0, append `&& exit` so the
     *  shell self-terminates (the install commands want this — once
     *  `go install` finishes, the shell wrapper has no further work). */
    closeOnSuccess?: boolean;
    /** Working directory for the spawned terminal. Defaults to the
     *  user's home directory. Callers that need to write files
     *  relative to CWD (e.g. install-ignore.sh writing
     *  `.gitignore`) MUST pass the target directory explicitly —
     *  otherwise the files land in `~/`. */
    cwd?: string;
}

/**
 * Wrap a string in single quotes, escaping any inner single quotes.
 * Used to make user-supplied paths / repo names safe to splice into
 * a shell command.
 */
export function quoteShellArg(value: string): string {
    if (value === "") return "''";
    return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Spawn a fresh terminal in the user's home directory and run `cmdline`
 * in it. Returns immediately; the terminal keeps running until the
 * command completes (or `closeOnSuccess: true` causes it to exit).
 *
 * If the terminals feature has not yet activated (no spawner wired),
 * shows an error message and returns without throwing — the caller is
 * typically a command-palette handler where swallowing is friendlier
 * than crashing the panel.
 *
 * Errors during `terminal.show(true)` / `sendText` are caught and
 * logged to the diagnostic channel — they never poison the caller's
 * promise chain.
 */
export async function spawnRunTerminal(
    baseName: string,
    cmdline: string,
    options: SpawnRunTerminalOptions = {}
): Promise<void> {
    const spawn = getTerminalSpawner();
    if (!spawn) {
        vscode.window.showErrorMessage(
            "Superset: Terminals 模組尚未啟用,請稍候再試"
        );
        return;
    }
    const stamp = new Date().toTimeString().slice(0, 8); // HH:MM:SS
    const finalCmdline = options.closeOnSuccess
        ? `${cmdline} && exit`
        : cmdline;
    const cwd = options.cwd ?? os.homedir();
    const terminal = spawn(`${baseName} (${stamp})`, cwd);
    try {
        terminal.show(true);
        await new Promise((resolve) => setTimeout(resolve, 200));
        terminal.sendText(finalCmdline + "\r");
    } catch (err) {
        getDiagnosticChannel()?.appendLine(
            `[superset] spawnRunTerminal failed for "${cmdline}": ${
                err instanceof Error ? err.message : String(err)
            }`
        );
    }
}
