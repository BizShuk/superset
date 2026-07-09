// globalCommandsPlugin — chrome commands that don't belong to a
// single feature (resetCaches, focusView, focusOverallView, showLogs,
// focusPanel). Implemented as an `ExtensionPlugin` so the
// `PluginManager` owns its disposable / reset-handler lifecycle
// alongside the feature plugins. The install-flavor commands
// (installDefaultTools / skillInstall / installIgnoreTemplate) live
// in `./installCommands` and are wired in via
// `registerInstallCommands()` below.

import * as vscode from "vscode";
import { type ExtensionPlugin, type PluginContext } from "./plugin";
import { collectSupersetKeys } from "./resetCaches";
import { getDiagnosticChannel, getPluginManager } from "./crossModuleState";
import { registerInstallCommands } from "./installCommands";

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

        // Install commands — extracted to ./installCommands for SRP.
        registerInstallCommands(ctx);

        ctx.log("globalCommands: registered");
    },
    deactivate(): void {
        // All disposables registered through `ctx.registerDisposable`
        // are released by the manager. Nothing extra to do.
    },
};
