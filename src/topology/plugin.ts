// topologyPlugin — `ExtensionPlugin` adapter for the Topology feature.
// The heavy lifting (TreeView, scan command) still lives in `./index.ts`
// as a plain `register(ctx: FeatureContext)` function, unchanged from
// before the plugin era. This adapter builds a `FeatureContext` out of
// a `PluginContext`, hands it to `register()`, and bridges every
// disposable the legacy register pushes into `ctx.subscriptions` into
// the plugin's managed pool.

import type * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
    createFeatureContext,
} from "../plugin";
import { register as registerTopologyModule } from "./index";
import type { FeatureHandle } from "../shared";

export const TOPOLOGY_PLUGIN_ID = "topology";

export const topologyPlugin: ExtensionPlugin = {
    id: TOPOLOGY_PLUGIN_ID,
    name: "Topology",
    activate(pCtx: PluginContext): void {
        const fCtx = createFeatureContext(pCtx, {
            statusBar: {} as vscode.StatusBarItem,
        });
        const handle: FeatureHandle = registerTopologyModule(fCtx);
        (
            pCtx as unknown as { __topologyHandle?: FeatureHandle }
        ).__topologyHandle = handle;
        pCtx.log("topology: registered");
    },
    deactivate(): void {
        // Force-dispose of plugin-managed disposables is handled by
        // `PluginManager.deactivateAll`. Nothing extra to do here.
    },
};
