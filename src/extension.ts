import * as vscode from "vscode";
import type { FeatureContext, SharedDeps } from "./types";
import { register as registerTerminals } from "./features/terminals";
import { register as registerExplorer } from "./features/explorer";
import { register as registerMdns } from "./features/mdns";
import { register as registerTopology } from "./features/topology";
import { register as registerTodo } from "./features/todo";

export function activate(context: vscode.ExtensionContext): void {
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

    const ctx: FeatureContext = {
        context,
        subscriptions,
        workspaceFolder,
        shared,
    };

    // Register all features.
    const features = [
        registerTerminals(ctx),
        registerExplorer(ctx),
        registerMdns(ctx),
        registerTopology(ctx),
        registerTodo(ctx),
    ];

    // Global commands (not tied to a single feature).
    subscriptions.push(
        vscode.commands.registerCommand("superset.focusView", () => {
            vscode.commands.executeCommand("workbench.view.superset");
        }),
        vscode.commands.registerCommand("superset.showLogs", () => {
            diag.show(true);
        }),
        vscode.commands.registerCommand("superset.focusPanel", async () => {
            const panelOrder = [
                "superset.terminals",
                "superset.explore",
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
}

export function deactivate(): void {
    // Disposables are torn down by VSCode via context.subscriptions.
}
