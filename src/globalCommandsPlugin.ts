// globalCommandsPlugin — chrome commands that don't belong to a
// single feature (resetCaches, focusView, focusOverallView, showLogs,
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
import { getDiagnosticChannel, getPluginManager } from "./crossModuleState";
import { registerInstallCommands } from "./installCommands";
import { getTreeViewRegistry } from "./plugin/treeViewRegistry";
import {
    renderDiagnosticsMarkdown,
    renderSettingsMarkdown,
    type DiagnosticsSnapshot,
} from "./diagnosticsPanel";
import type { ExtensionManifest } from "./diagnosticsPanel.types";
// `package.json` is shipped as a real file; the build emits it to
// `out/extension.js`'s sibling, so we can `require` it. We type the
// return as our narrow `ExtensionManifest` so the renderer stays
// free of `vscode` types.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson: ExtensionManifest = require("../package.json");

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
                    const registry = getTreeViewRegistry();
                    if (!registry) {
                        ctx.log(
                            "globalCommands: revealInTree — TreeViewRegistry not initialized"
                        );
                        return false;
                    }
                    return registry.reveal(
                        args.viewId,
                        args.predicate,
                        ctx.log
                    );
                }
            )
        );

        // Open Settings — render the registered `superset.*` command
        // surface as a Markdown overview, then open in the markdown
        // preview. Minimal viable version of the original
        // OpenSettings WebView plan (☆5) — the WebView can be
        // layered on top later without changing this command.
        ctx.registerDisposable(
            vscode.commands.registerCommand(
                "superset.openSettings",
                async () => {
                    const md = renderSettingsMarkdown(packageJson);
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

        // Show Diagnostics — one-shot snapshot of every subsystem.
        // Pulls counts from the live PluginManager (the
        // PluginManager doesn't currently expose per-plugin state
        // for terminals/mDNS counts, so the snapshot is best-effort
        // with `0` placeholders for subsystems that don't expose a
        // counter yet). Future iterations can pipe real counts once
        // the registries expose observers.
        ctx.registerDisposable(
            vscode.commands.registerCommand(
                "superset.showDiagnostics",
                async () => {
                    const manager = getPluginManager();
                    const pluginIds = manager
                        ? (manager as unknown as {
                              listIds?: () => string[];
                          }).listIds?.() ?? []
                        : [];
                    const snapshot: DiagnosticsSnapshot = {
                        capturedAt: new Date(),
                        terminalCount: 0,
                        unseenTerminalCount: 0,
                        mDNSServiceCount: 0,
                        todoItemCount: 0,
                        projectsTodoProjectCount: 0,
                        activePluginIds: pluginIds,
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
    deactivate(): void {
        // All disposables registered through `ctx.registerDisposable`
        // are released by the manager. Nothing extra to do.
    },
};
