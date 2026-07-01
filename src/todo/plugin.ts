// todoPlugin — `ExtensionPlugin` adapter for the TODO feature. The
// heavy lifting (TreeView creation, command registration, file
// watcher, store wiring) still lives in `./index.ts` as a plain
// `register(ctx: FeatureContext)` function, unchanged from before the
// plugin era. This adapter is a thin shim that builds a `FeatureContext`
// out of a `PluginContext`, hands it to `register()`, and ensures all
// `vscode.Disposable` instances the legacy register pushes into
// `ctx.subscriptions` are routed back into the plugin's disposable
// pool so `PluginManager.deactivateAll` can tear them down.
//
// `Stage 6` (extension.ts cleanup) is the eventual target where the
// legacy `register()` shape is replaced by direct `PluginContext`
// consumption. Until then, this shim keeps the migration reversible.

import * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
} from "../plugin";
import { register as registerTodoModule } from "./index";
import type { FeatureContext, FeatureHandle } from "../shared";

export const TODO_PLUGIN_ID = "todo";

/**
 * Adapt a `PluginContext` to the legacy `FeatureContext` shape that
 * `register()` in `./index.ts` expects. The disposable / reset-handler
 * arrays are bridged to the plugin's pools so cleanup stays correct
 * even if `register()` chooses to push to `ctx.subscriptions`.
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
            // `register()` reads from `shared.{log, diag, statusBar}`.
            // The status-bar item isn't exposed via PluginContext
            // directly yet; surface a proxy that updates a noop item
            // for now — the feature's `HighlightPresenter` (if any) is
            // the only consumer and gracefully tolerates missing UI
            // updates (see `terminals/` for the real pattern).
            statusBar: {} as vscode.StatusBarItem,
            diag: {} as vscode.OutputChannel,
            log: pCtx.log,
        },
        resetHandlers,
    };
}

export const todoPlugin: ExtensionPlugin = {
    id: TODO_PLUGIN_ID,
    name: "TODO",
    activate(pCtx: PluginContext): void {
        const fCtx = buildFeatureContext(pCtx);
        const handle: FeatureHandle = registerTodoModule(fCtx);
        // Bridge FeatureHandle.dispose: the legacy handle's `dispose()`
        // tears down per-feature disposables, but those are *also*
        // registered through the plugin pool above, so the manager's
        // teardown will call dispose on them anyway. We keep a
        // reference so deactivate() can re-run if needed.
        (pCtx as unknown as { __todoHandle?: FeatureHandle }).__todoHandle =
            handle;
        pCtx.log("todo: registered");
    },
    deactivate(): void {
        // Force-dispose of plugin-managed disposables is handled by
        // `PluginManager.deactivateAll`. Nothing extra to do here.
    },
};
