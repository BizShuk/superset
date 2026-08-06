// spawnRunTerminal — opens a fresh native terminal and runs a
// command in it. Used by the install commands (installDefaultTools,
// skillInstall, projectsSetup, installDefaultProject) and anything else that needs
// to dispatch work to a user-visible terminal without blocking the
// command caller.
//
// Moved out of `globalCommandsPlugin.ts` as Plan 2 Stage B — keeps
// the chrome-commands file focused on view/log/panel orchestration.

import * as os from "node:os";
import type { PluginContext } from "./plugin";
import { quoteShellArg } from "./shellCommand";

export { quoteShellArg } from "./shellCommand";

export interface SpawnRunTerminalOptions {
    /** When `true` and the command exits 0, append `&& exit` so the
     *  shell self-terminates (the install commands want this — once
     *  `go install` finishes, the shell wrapper has no further work). */
    closeOnSuccess?: boolean;
    cwd?: string;
    /** When `true` (default), the spawned terminal does not take editor/view
     *  focus. Pass `false` to explicitly move focus to the terminal panel. */
    preserveFocus?: boolean;
}

/**
 * Spawn a fresh terminal in the user's home directory and run `cmdline`
 * in it. Returns immediately; the terminal keeps running until the
 * command completes (or `closeOnSuccess: true` causes it to exit).
 *
 * Errors during terminal creation, `show(...)`, or `sendText` are caught
 * and logged through the caller's plugin context.
 */
export async function spawnRunTerminal(
    ctx: Pick<PluginContext, "createTerminal" | "log">,
    baseName: string,
    cmdline: string,
    options: SpawnRunTerminalOptions = {}
): Promise<void> {
    const stamp = new Date().toTimeString().slice(0, 8); // HH:MM:SS
    const finalCmdline = options.closeOnSuccess
        ? `${cmdline} && exit`
        : cmdline;
    const cwd = options.cwd ?? os.homedir();
    const preserveFocus = options.preserveFocus ?? true;
    try {
        const terminal = ctx.createTerminal(`${baseName} (${stamp})`, cwd);
        terminal.show(preserveFocus);
        await new Promise((resolve) => setTimeout(resolve, 200));
        // `sendText` appends the platform newline itself. The explicit
        // trailing `\r` this used to carry was for the pseudoterminal's
        // `handleInput`, which took raw key bytes; a native terminal would
        // read it as a second Enter and leave a stray prompt behind.
        terminal.sendText(finalCmdline);
    } catch (err) {
        ctx.log(
            `spawnRunTerminal failed for "${cmdline}": ${
                err instanceof Error ? err.message : String(err)
            }`
        );
    }
}
