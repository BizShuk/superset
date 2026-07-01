// globalCommandsPlugin — aggregates the cross-cutting commands that
// don't belong to a single feature (resetCaches, focusView, showLogs,
// focusPanel). Implemented as an `ExtensionPlugin` so the
// `PluginManager` owns its disposable / reset-handler lifecycle
// alongside the feature plugins. Replaces the inline command block
// that used to live in the bottom of `src/extension.ts`.

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

        ctx.log("globalCommands: registered");
    },
    deactivate(): void {
        // All disposables registered through `ctx.registerDisposable`
        // are released by the manager. Nothing extra to do.
    },
};
