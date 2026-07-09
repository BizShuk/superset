// globalCommandsPlugin — aggregates the cross-cutting commands that
// don't belong to a single feature (resetCaches, focusView, showLogs,
// focusPanel, installIgnoreTemplate). Implemented as an `ExtensionPlugin`
// so the `PluginManager` owns its disposable / reset-handler lifecycle
// alongside the feature plugins. Replaces the inline command block
// that used to live in the bottom of `src/extension.ts`.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { type ExtensionPlugin, type PluginContext } from "./plugin";
import { collectSupersetKeys } from "./resetCaches";
import {
    getDiagnosticChannel,
    getPluginManager,
    getTerminalSpawner,
} from "./crossModuleState";

export const GLOBAL_COMMANDS_PLUGIN_ID = "globalCommands";

export const globalCommandsPlugin: ExtensionPlugin = {
    id: GLOBAL_COMMANDS_PLUGIN_ID,
    name: "Global Commands",
    activate(ctx: PluginContext): void {
        ctx.registerDisposable(
            vscode.commands.registerCommand(
                "superset.resetCaches",
                async () => {
                    const choice = await vscode.window.showWarningMessage(
                        "Superset: 確認重置所有快取?",
                        { modal: true },
                        "Reset"
                    );
                    if (choice !== "Reset") return;
                    for (const key of collectSupersetKeys(
                        ctx.workspaceState
                    )) {
                        await ctx.workspaceState.update(key, undefined);
                    }
                    const manager = getPluginManager();
                    if (manager) {
                        await manager.resetAll();
                    }
                    vscode.window.showInformationMessage(
                        "Superset: 快取已重置"
                    );
                }
            )
        );

        ctx.registerDisposable(
            vscode.commands.registerCommand(
                "superset.focusView",
                async () => {
                    await vscode.commands.executeCommand(
                        "workbench.view.extension.superset"
                    );
                    await vscode.commands.executeCommand(
                        "superset.terminals.focus"
                    );
                }
            )
        );

        ctx.registerDisposable(
            vscode.commands.registerCommand(
                "superset.focusOverallView",
                async () => {
                    await vscode.commands.executeCommand(
                        "workbench.view.extension.superset-overall"
                    );
                    await vscode.commands.executeCommand(
                        "superset.projects.focus"
                    );
                }
            )
        );

        ctx.registerDisposable(
            vscode.commands.registerCommand("superset.showLogs", () => {
                getDiagnosticChannel()?.show(true);
            })
        );

        ctx.registerDisposable(
            vscode.commands.registerCommand("superset.focusPanel", async () => {
                await vscode.commands.executeCommand(
                    "workbench.view.extension.superset"
                );
                const panelOrder = [
                    "superset.terminals",
                    "superset.mdns",
                    "superset.topology",
                    "superset.todo",
                ];
                for (const viewId of panelOrder) {
                    try {
                        await vscode.commands.executeCommand(
                            `${viewId}.focus`
                        );
                        break;
                    } catch {
                        // View might not be visible, try next.
                    }
                }
            })
        );

        // Install the default toolchain (`pm2` and `skills` from the
        // bizshuk org at master). Both are long-running `go install`
        // invocations that download + compile. Each gets its own
        // dedicated terminal so the user can watch them side by side,
        // abort either with Ctrl-C without affecting the other, and
        // we don't end up with one install's compiler errors flooding
        // the other's log. The cmdline is suffixed with `&& exit` so
        // the shell auto-closes on success (`exit` is only reached if
        // `&&` short-circuits past the install); on non-zero exit the
        // shell stays open and the user reads the error. No
        // confirmation modal — these match the user's "fire from the
        // command palette" intent and are idempotent in the sense that
        // re-running just refreshes the cached binaries.
        ctx.registerDisposable(
            vscode.commands.registerCommand(
                "superset.installDefaultTools",
                async () => {
                    if (!getTerminalSpawner()) {
                        vscode.window.showErrorMessage(
                            "Superset: Terminals 模組尚未啟用,請稍候再試"
                        );
                        return;
                    }
                    const tools: { label: string; cmd: string }[] = [
                        {
                            label: "pm2",
                            cmd: "go install github.com/bizshuk/pm2@master",
                        },
                        {
                            label: "skills",
                            cmd: "go install github.com/bizshuk/skills@master",
                        },
                    ];
                    for (const tool of tools) {
                        // `spawnRunTerminal` adds its own
                        // `(<HH:MM:SS>)` timestamp suffix; we keep
                        // the base name clean so the final terminal
                        // name doesn't carry a duplicate. The
                        // helper appends `&& exit` so the shell
                        // self-closes on success — see its doc for
                        // the contract.
                        await spawnRunTerminal(
                            `Superset: Install ${tool.label}`,
                            tool.cmd,
                            { closeOnSuccess: true }
                        );
                    }
                    ctx.log(
                        "globalCommands: installDefaultTools dispatched (pm2 + skills @master, two terminals)"
                    );
                }
            )
        );

        // Install a Claude Code skill from a GitHub repo via the
        // `skills` CLI. Default repo is the user's cc-plugin fork; an
        // explicit repo can be passed via the command's `args.repo`
        // parameter (e.g. wired up by a future TreeView menu). An
        // InputBox is shown with the resolved repo pre-filled, so the
        // user can press Enter to accept the default, edit and press
        // Enter to override, or press Esc to cancel. This replaces
        // the earlier two-step "modal confirm" flow — once the user
        // has typed the final value into the input, no second
        // confirmation is needed.
        ctx.registerDisposable(
            vscode.commands.registerCommand(
                "superset.skillInstall",
                async (args?: { repo?: string }) => {
                    const defaultRepo = args?.repo ?? "bizshuk/cc-plugin";
                    const input = await vscode.window.showInputBox({
                        title: "Superset: Skill Install",
                        prompt:
                            "要安裝的 skill repo (GitHub owner/repo)。直接 Enter 接受預設。",
                        placeHolder: "owner/repo",
                        value: defaultRepo,
                        // Selecting the whole string lets the user
                        // immediately type a new value to replace
                        // the default without first deleting it.
                        valueSelection: [0, defaultRepo.length],
                    });
                    if (input === undefined) {
                        ctx.log(
                            `globalCommands: skillInstall cancelled by user (input dismissed)`
                        );
                        return;
                    }
                    // Empty input (user cleared the field then
                    // pressed Enter) falls back to the default. This
                    // matches the documented "直接 Enter 接受預設"
                    // affordance — an empty string is not a
                    // meaningful repo override.
                    const repo = input.trim() || defaultRepo;
                    await spawnRunTerminal(
                        `Superset: Skill Install (${repo})`,
                        `skills add ${repo}`,
                        { closeOnSuccess: true }
                    );
                    ctx.log(
                        `globalCommands: skillInstall dispatched (${repo})`
                    );
                }
            )
        );

        // Install the ignore template (resources/config/.ignore) into
        // the workspace as .gitignore / .geminiignore / .claudeignore.
        // Resolves the script relative to the extension's install root
        // (not the workspace) so it works regardless of cwd.
        ctx.registerDisposable(
            vscode.commands.registerCommand(
                "superset.installIgnoreTemplate",
                async (args?: { targets?: string[]; force?: boolean }) => {
                    const scriptPath = path.join(
                        ctx.extensionUri.fsPath,
                        "resources",
                        "config",
                        "install-ignore.sh"
                    );

                    // Decide which targets to act on. When the user
                    // invokes from the command palette (no args),
                    // default to all three (.gitignore /
                    // .geminiignore / .claudeignore).
                    const requested = args?.targets ?? [
                        "git",
                        "gemini",
                        "claude",
                    ];

                    // Safety: if any requested target file already
                    // exists, ask the user before overwriting.
                    // Hand-rolled .gitignore in this repo is exactly
                    // the case the user might want to *keep* if they
                    // customised it — don't silently clobber.
                    let force = args?.force ?? false;
                    if (!force) {
                        const outNames: Record<string, string> = {
                            git: ".gitignore",
                            gemini: ".geminiignore",
                            claude: ".claudeignore",
                        };
                        const existing = requested
                            .map((t) => outNames[t])
                            .filter((n) =>
                                fs.existsSync(path.join(ctx.workspaceFolder, n))
                            );
                        if (existing.length > 0) {
                            const choice = await vscode.window.showWarningMessage(
                                `Superset: 以下檔案已存在,將被模板覆蓋:\n  ${existing.join(
                                    ", "
                                )}\n\n繼續?`,
                                { modal: true },
                                "Overwrite",
                                "Cancel"
                            );
                            if (choice !== "Overwrite") {
                                ctx.log(
                                    "globalCommands: installIgnoreTemplate cancelled by user"
                                );
                                return;
                            }
                            force = true;
                        }
                    }

                    const argv = ["bash", scriptPath];
                    for (const t of requested) argv.push(t);
                    if (force) argv.push("--force");

                    await spawnRunTerminal(
                        "Superset: Install Ignore Template",
                        argv.map(quoteShellArg).join(" "),
                        { closeOnSuccess: true }
                    );
                    ctx.log(
                        `globalCommands: installIgnoreTemplate ${argv.join(" ")}`
                    );
                }
            )
        );

        ctx.log("globalCommands: registered");
    },
    deactivate(): void {
        // All disposables registered through `ctx.registerDisposable`
        // are released by the manager. Nothing extra to do.
    },
};

/** Quote a single argv entry for safe inclusion in a `bash -c` command
 *  string. Wraps the value in single quotes and escapes any embedded
 *  single quotes (`'` → `'\''`). Empty string becomes `''`. */
function quoteShellArg(value: string): string {
    if (value === "") return "''";
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface SpawnRunTerminalOptions {
    /** When true, the cmdline is suffixed with `&& exit` so the
     *  shell self-terminates on success. The PTY host's existing
     *  `proc.onExit` wiring then drives VSCode to remove the
     *  terminal tab — no listener / sentinel / timeout needed in
     *  the extension. On non-zero exit, `&&` short-circuits, the
     *  shell stays open, and the user reads the error. */
    closeOnSuccess?: boolean;
}

/**
 * Open a fresh PTY-backed VSCode terminal and send a single command
 * line for execution. Reliability hardening for `terminal.sendText`:
 *
 * - **PTY-backed via the terminals module's spawner**: we cannot
 *   use `vscode.window.createTerminal` directly. The auto-PTY layer
 *   in `src/terminals/index.ts` would see the new plain terminal,
 *   decide "plain panel terminal" → replace it with a PTY-backed
 *   clone, then `setTimeout(() => original.dispose(), 150)` — which
 *   races our `sendText` and either throws "Terminal has already
 *   been disposed" or silently no-ops. Going through the spawner
 *   returns the **same** PTY-backed terminal the auto-replace layer
 *   would have created, so the disposal race is avoided entirely.
 * - **Unique name** (`<base> <HH:MM:SS>`): every invocation gets a
 *   brand-new terminal. Reusing a terminal whose PTY still holds a
 *   previous TUI session is the most common cause of "sendText
 *   seems to do nothing" — the keystrokes are buffered behind the
 *   running program's input handle.
 * - **`cwd: homedir`**: install / shell-installer commands are
 *   host-wide, not workspace-bound. Running from `$HOME` also
 *   avoids the workspace being inside a TUI-active directory.
 * - **Brief warm-up (200ms)**: the PTY host spawns the shell when
 *   VSCode calls `pty.open()` (triggered by `.show()`). We give
 *   it a small async window so the shell is alive and the first
 *   command line is not fed into a half-initialised terminal.
 * - **Trailing `\r`**: PTY line discipline treats `\r` as the
 *   carriage return that submits the input buffer. `\n` alone just
 *   moves the cursor to a new line and the line never submits.
 * - **Optional `&& exit` auto-close** (`{ closeOnSuccess: true }`):
 *   the cmdline is suffixed with `&& exit` so the shell
 *   self-terminates on success. `PtyTerminalHost.close()` is
 *   already wired to `proc.onExit`, so VSCode removes the terminal
 *   tab the instant the shell dies — no sentinel buffer, no
 *   timeout, no manual `terminal.dispose()` call. On non-zero exit
 *   the `&&` short-circuits and the shell (with its prompt and
 *   error output) stays open for the user to read.
 *
 * If the terminals feature has not activated yet (e.g. the user
 * invoked the command during the very first frame of activation),
 * the spawner is `undefined` and we surface a non-modal error
 * instead of throwing. Errors thrown by `show()` / `sendText()` are
 * caught and logged so a single failure does not poison the
 * caller's promise chain.
 */
async function spawnRunTerminal(
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
    const terminal = spawn(`${baseName} (${stamp})`, os.homedir());
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
