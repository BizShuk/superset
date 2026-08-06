// globalCommandsPlugin — chrome commands that don't belong to a
// single feature (resetCaches, focusView, showLogs,
// focusPanel). Implemented as an `ExtensionPlugin` so the
// `PluginManager` owns its disposable / reset-handler lifecycle
// alongside the feature plugins. The install-flavor commands
// (installDefaultTools / skillInstall / projectsSetup /
// installDefaultProject) live
// in `./installCommands` and are wired in via
// `registerInstallCommands()` below.

import * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
} from "./plugin";
import { collectSupersetKeys } from "./resetCaches";
import { registerInstallCommands } from "./installCommands";
import {
    DIAGNOSTIC_METRIC,
    renderDiagnosticsMarkdown,
    type DiagnosticsSnapshot,
} from "./diagnostics";

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
                    await ctx.resetAll();
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
                ctx.showLogs();
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

        // Cross-panel `superset.revealInTree` command. Walks the
        // named panel's tree (registered via ctx.registerTreeView)
        // looking for an item matching `predicate`, then focuses +
        // selects the matching row. Returns `true` on success, `false`
        // when the viewId is unknown or the predicate never matches.
        // Args: { viewId: string, predicate: (item: unknown) => boolean }
        ctx.registerDisposable(
            vscode.commands.registerCommand(
                "superset.revealInTree",
                async (args?: {
                    viewId?: string;
                    predicate?: (item: unknown) => boolean;
                }) => {
                    if (
                        !args ||
                        typeof args.viewId !== "string" ||
                        typeof args.predicate !== "function"
                    ) {
                        ctx.log(
                            "globalCommands: revealInTree called without {viewId, predicate}"
                        );
                        return false;
                    }
                    return ctx.revealInTree(args.viewId, args.predicate);
                }
            )
        );

        // Open the native Settings UI filtered to this extension.
        ctx.registerDisposable(
            vscode.commands.registerCommand(
                "superset.openSettings",
                async () => {
                    await vscode.commands.executeCommand(
                        "workbench.action.openSettings",
                        "@ext:shuk.superset"
                    );
                }
            )
        );

        // Show Diagnostics — one live, fail-soft runtime snapshot.
        ctx.registerDisposable(
            vscode.commands.registerCommand(
                "superset.showDiagnostics",
                async () => {
                    const runtime = ctx.getRuntimeDiagnostics();
                    const snapshot: DiagnosticsSnapshot = {
                        capturedAt: new Date(),
                        terminalCount:
                            runtime.metrics[
                                DIAGNOSTIC_METRIC.terminalCount
                            ],
                        unseenTerminalCount:
                            runtime.metrics[
                                DIAGNOSTIC_METRIC.unseenTerminalCount
                            ],
                        mDNSServiceCount:
                            runtime.metrics[
                                DIAGNOSTIC_METRIC.mDNSServiceCount
                            ],
                        todoItemCount:
                            runtime.metrics[
                                DIAGNOSTIC_METRIC.todoItemCount
                            ],
                        activePluginIds: runtime.activePluginIds,
                    };
                    const md = renderDiagnosticsMarkdown(snapshot);
                    const doc = await vscode.workspace.openTextDocument({
                        content: md,
                        language: "markdown",
                    });
                    await vscode.commands.executeCommand(
                        "markdown.showPreview",
                        doc.uri
                    );
                }
            )
        );

        ctx.log("globalCommands: registered");
    },
};
