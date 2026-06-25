import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../../types";
import { ExplorerStore } from "../../explorerStore";
import { VscodeFsAdapter } from "../../fsAdapter";
import { ExplorerTreeProvider } from "../../explorerTreeProvider";

export function register(ctx: FeatureContext): FeatureHandle {
    const store = new ExplorerStore(new VscodeFsAdapter());
    store.start();

    const provider = new ExplorerTreeProvider(store);
    provider.start();

    const view = vscode.window.createTreeView("superset.explore", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    const refreshCmd = vscode.commands.registerCommand(
        "superset.exploreRefresh",
        () => {
            store.refreshAll();
            provider.refresh();
        }
    );

    const openCmd = vscode.commands.registerCommand(
        "superset.exploreOpen",
        async (node: { uri: string; isDirectory: boolean } | undefined) => {
            if (!node || node.isDirectory) return;
            const uri = vscode.Uri.file(node.uri);
            await vscode.commands.executeCommand("vscode.open", uri);
        }
    );

    ctx.subscriptions.push(
        refreshCmd,
        openCmd,
        view,
        { dispose: () => provider.stop() },
        { dispose: () => store.stop() }
    );

    return {
        dispose() {
            provider.stop();
            store.stop();
            refreshCmd.dispose();
            openCmd.dispose();
            view.dispose();
        },
    };
}
