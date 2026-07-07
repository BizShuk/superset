// globalCommandsPlugin — aggregates the cross-cutting commands that
// don't belong to a single feature (resetCaches, focusView, showLogs,
// focusPanel, installIgnoreTemplate). Implemented as an `ExtensionPlugin`
// so the `PluginManager` owns its disposable / reset-handler lifecycle
// alongside the feature plugins. Replaces the inline command block
// that used to live in the bottom of `src/extension.ts`.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
    type PluginManager,
} from "./plugin";
import { collectSupersetKeys } from "./resetCaches";

export const GLOBAL_COMMANDS_PLUGIN_ID = "globalCommands";

/** The diagnostic `OutputChannel` reference, captured by the plugin
 *  from the PluginContext. There is no `PluginContext.diag` accessor
 *  (the manager only exposes `log`); the channel is set once by
 *  `extension.ts` via `setDiagnosticChannel()` after construction. */
let diagnosticChannel: vscode.OutputChannel | undefined;
export function setDiagnosticChannel(channel: vscode.OutputChannel): void {
    diagnosticChannel = channel;
}

/** Manager reference, set by `extension.ts` after construction. The
 *  resetCaches command needs to call `manager.resetAll()` so each
 *  plugin's reset handlers run in order under the manager's error
 *  boundary. */
let managerRef: PluginManager | undefined;
export function setPluginManager(mgr: PluginManager): void {
    managerRef = mgr;
}

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
                    if (managerRef) {
                        await managerRef.resetAll();
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
                diagnosticChannel?.show(true);
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

                    const terminal = vscode.window.createTerminal({
                        name: "Superset: Install Ignore Template",
                        cwd: ctx.workspaceFolder,
                    });
                    terminal.show(true);
                    terminal.sendText(argv.map(quoteShellArg).join(" "));
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
