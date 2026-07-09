import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import { TopologyStore } from "./topologyStore";
import { NodeTopologyScanner } from "./topologyScanner";
import { TopologyTreeProvider } from "./treeProvider";
import { getTreeViewRegistry } from "../plugin/treeViewRegistry";

export function register(ctx: FeatureContext): FeatureHandle {
    const store = new TopologyStore(new NodeTopologyScanner());
    store.start();

    const provider = new TopologyTreeProvider(store);
    provider.start();

    ctx.resetHandlers.push(() => {
        store.reset();
        provider.refresh();
    });

    const view = vscode.window.createTreeView("superset.topology", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    // Report active view for panel-layout persistence (plan §3).
    const visibilitySub = view.onDidChangeVisibility((visible) => {
        if (visible) {
            void vscode.commands.executeCommand(
                "superset.reportViewVisible",
                "superset.topology"
            );
        }
    });

    // Cross-panel reveal-in-tree wiring.
    const treeViewEntry = getTreeViewRegistry()?.register(
        "superset.topology",
        view as unknown as vscode.TreeView<unknown>,
        provider as unknown as vscode.TreeDataProvider<unknown>,
        ctx.shared.log
    );

    const scanCmd = vscode.commands.registerCommand(
        "superset.topologyScan",
        async () => {
            vscode.window.showInformationMessage("掃描網路拓撲中...");
            await store.scan();
            provider.refresh();
            vscode.window.showInformationMessage("網路拓撲掃描完成");
        }
    );

    ctx.subscriptions.push(
        scanCmd,
        view,
        visibilitySub,
        // TreeViewRegistry entry — see TODO/mDNS wiring notes.
        treeViewEntry ?? { dispose: () => undefined },
        { dispose: () => provider.stop() },
        { dispose: () => store.stop() }
    );

    return {
        dispose() {
            provider.stop();
            store.stop();
            scanCmd.dispose();
            view.dispose();
        },
    };
}
