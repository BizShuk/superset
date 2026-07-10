// mdnsPlugin — `ExtensionPlugin` adapter for the mDNS feature. The
// heavy lifting (TreeView, commands, transport wiring) still lives in
// `./index.ts` as a plain `register(ctx: FeatureContext)` function,
// unchanged from before the plugin era. This adapter builds a
// `FeatureContext` out of a `PluginContext`, hands it to `register()`,
// and bridges every disposable the legacy register pushes into
// `ctx.subscriptions` into the plugin's managed pool.

import type * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
    createFeatureContext,
} from "../plugin";
import { register as registerMdnsModule } from "./index";
import type { FeatureHandle } from "../shared";

export const MDNS_PLUGIN_ID = "mdns";

export const mdnsPlugin: ExtensionPlugin = {
    id: MDNS_PLUGIN_ID,
    name: "mDNS",
    activate(pCtx: PluginContext): void {
        const fCtx = createFeatureContext(pCtx, {
            statusBar: {} as vscode.StatusBarItem,
        });
        const handle: FeatureHandle = registerMdnsModule(fCtx);
        (pCtx as unknown as { __mdnsHandle?: FeatureHandle }).__mdnsHandle =
            handle;
        pCtx.log("mdns: registered");
    },
    deactivate(): void {
        // Force-dispose of plugin-managed disposables is handled by
        // `PluginManager.deactivateAll`. Nothing extra to do here.
    },
};
