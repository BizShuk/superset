// mdnsPlugin — `ExtensionPlugin` adapter for the mDNS feature. The
// heavy lifting (TreeView, commands, transport wiring) still lives in
// `./index.ts` as a plain `register(ctx: FeatureContext)` function,
// unchanged from before the plugin era. This adapter is a thin shim
// that builds a `FeatureContext` out of a `PluginContext`, hands it to
// `register()`, and bridges every disposable the legacy register
// pushes into `ctx.subscriptions` into the plugin's managed pool.

import * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
} from "../plugin";
import { register as registerMdnsModule } from "./index";
import type { FeatureContext, FeatureHandle } from "../shared";

export const MDNS_PLUGIN_ID = "mdns";

/**
 * Adapt a `PluginContext` to the legacy `FeatureContext` shape that
 * `register()` in `./index.ts` expects. The disposable / reset-handler
 * arrays are bridged so cleanup stays correct.
 */
function buildFeatureContext(pCtx: PluginContext): FeatureContext {
    const subscriptions: vscode.Disposable[] = [];
    const resetHandlers: (() => void | Promise<void>)[] = [];

    // Forward every disposable that `register()` pushes into the
    // shim's subscriptions array into the plugin's managed pool.
    const originalPush = subscriptions.push.bind(subscriptions);
    subscriptions.push = (...items: vscode.Disposable[]): number => {
        for (const d of items) {
            pCtx.registerDisposable(d);
        }
        return originalPush(...items);
    };

    return {
        context: {
            subscriptions,
            extensionUri: pCtx.extensionUri,
            globalState: pCtx.globalState,
            workspaceState: pCtx.workspaceState,
        } as unknown as vscode.ExtensionContext,
        subscriptions,
        workspaceFolder: pCtx.workspaceFolder,
        shared: {
            statusBar: {} as vscode.StatusBarItem,
            diag: {} as vscode.OutputChannel,
            log: pCtx.log,
        },
        resetHandlers,
    };
}

export const mdnsPlugin: ExtensionPlugin = {
    id: MDNS_PLUGIN_ID,
    name: "mDNS",
    activate(pCtx: PluginContext): void {
        const fCtx = buildFeatureContext(pCtx);
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
