import * as vscode from "vscode";
import type { FeatureContext, SharedDeps } from "./shared";
import { collectSupersetKeys } from "./resetCaches";
import { register as registerTerminals } from "./terminals";
import { register as registerMdns } from "./mdns";
import { register as registerTopology } from "./topology";
import { register as registerTodo } from "./todo";
import {
    createTreePreviewExtension,
    type MarkdownItExtension,
} from "./treePreview";

export function activate(
    context: vscode.ExtensionContext
): MarkdownItExtension {
    console.log("[superset] activated");

    const subscriptions: vscode.Disposable[] = [];

    // Diagnostic channel.
    const diag = vscode.window.createOutputChannel("Superset");
    const log = (msg: string) => {
        const stamped = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
        console.log(`[superset] ${msg}`);
        diag.appendLine(stamped);
    };
    log(`activate session=${vscode.env.sessionId.slice(0, 8)}`);

    // Shared status bar — owned by this root so it survives across features.
    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBar.name = "Superset";

    const workspaceFolder =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    const shared: SharedDeps = { statusBar, diag, log };
    const resetHandlers: (() => void | Promise<void>)[] = [];

    const ctx: FeatureContext = {
        context,
        subscriptions,
        workspaceFolder,
        shared,
        resetHandlers,
    };

    // Register all features.
    const features = [
        registerTerminals(ctx),
        registerMdns(ctx),
        registerTopology(ctx),
        registerTodo(ctx),
    ];

    // Global commands (not tied to a single feature).
    subscriptions.push(
        vscode.commands.registerCommand("superset.resetCaches", async () => {
            const choice = await vscode.window.showWarningMessage(
                "Superset: 確認重置所有快取?",
                { modal: true },
                "Reset"
            );
            if (choice !== "Reset") return;
            for (const key of collectSupersetKeys(context.workspaceState)) {
                await context.workspaceState.update(key, undefined);
            }
            for (const handler of resetHandlers) {
                try {
                    await handler();
                } catch (err) {
                    log(`Error running reset handler: ${err}`);
                }
            }
            vscode.window.showInformationMessage("Superset: 快取已重置");
        }),
        vscode.commands.registerCommand("superset.focusView", async () => {
            // Open the Superset view container, then focus the terminals
            // view — the "terminal dashboard" the status-bar notification
            // points at. `workbench.view.extension.<id>` is the built-in
            // command for extension-contributed activity-bar containers;
            // the bare `workbench.view.superset` form is unregistered and
            // silently no-ops.
            await vscode.commands.executeCommand(
                "workbench.view.extension.superset"
            );
            await vscode.commands.executeCommand("superset.terminals.focus");
        }),
        vscode.commands.registerCommand("superset.showLogs", () => {
            diag.show(true);
        }),
        vscode.commands.registerCommand("superset.focusPanel", async () => {
            const panelOrder = [
                "superset.terminals",
                "superset.mdns",
                "superset.topology",
                "superset.todo",
            ];
            await vscode.commands.executeCommand(
                "workbench.view.extension.superset"
            );
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
        }),
    );

    // Push all disposables into context for VSCode teardown.
    for (const d of subscriptions) {
        context.subscriptions.push(d);
    }

    // Surface the Markdown preview contribution (ported from
    // md-tree-highlight). VSCode reads this return value when the manifest
    // declares `markdown.markdownItPlugins`.
    return createTreePreviewExtension();
}

export function deactivate(): void {
    // Disposables are torn down by VSCode via context.subscriptions.
}
