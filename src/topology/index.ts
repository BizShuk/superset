import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import { TopologyStore } from "./topologyStore";
import { NodeTopologyScanner } from "./topologyScanner";
import { TopologyTreeProvider } from "./treeProvider";

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
