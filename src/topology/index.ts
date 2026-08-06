import * as vscode from "vscode";
import type { PluginContext } from "../plugin";
import { TopologyStore } from "./topologyStore";
import { NodeTopologyScanner } from "./topologyScanner";
import { TopologyTreeProvider } from "./treeProvider";
import { registerViewVisibility } from "../plugin/viewVisibility";

export function register(ctx: PluginContext): void {
    const store = new TopologyStore(new NodeTopologyScanner());
    store.start();

    const provider = new TopologyTreeProvider(store);
    provider.start();

    ctx.registerResetHandler(() => {
        store.reset();
        provider.refresh();
    });

    const view = vscode.window.createTreeView("superset.topology", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    // Report active view for panel-layout persistence (plan §3).
    const visibilitySub = registerViewVisibility(view, "superset.topology");

    // Cross-panel reveal-in-tree wiring.
    ctx.registerTreeView(
        "superset.topology",
        view,
        provider
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

    for (const disposable of [
        scanCmd,
        view,
        visibilitySub,
        { dispose: () => provider.stop() },
        { dispose: () => store.stop() },
    ]) {
        ctx.registerDisposable(disposable);
    }
}
