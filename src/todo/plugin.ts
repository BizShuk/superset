// todoPlugin — `ExtensionPlugin` adapter for the TODO feature. The
// heavy lifting (TreeView creation, command registration, file
// watcher, store wiring) still lives in `./index.ts` as a plain
// `register(ctx: FeatureContext)` function, unchanged from before the
// plugin era. This adapter builds a `FeatureContext` out of a
// `PluginContext`, hands it to `register()`, and routes every
// `vscode.Disposable` the legacy register pushes into `ctx.subscriptions`
// into the plugin's disposable pool so `PluginManager.deactivateAll`
// can tear them down.
//
// `Stage 6` (extension.ts cleanup) is the eventual target where the
// legacy `register()` shape is replaced by direct `PluginContext`
// consumption. Until then, this shim keeps the migration reversible.

import type * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
    createFeatureContext,
} from "../plugin";
import { register as registerTodoModule } from "./index";
import type { FeatureHandle } from "../shared";

export const TODO_PLUGIN_ID = "todo";

export const todoPlugin: ExtensionPlugin = {
    id: TODO_PLUGIN_ID,
    name: "TODO",
    activate(pCtx: PluginContext): void {
        const fCtx = createFeatureContext(pCtx, {
            statusBar: {} as vscode.StatusBarItem,
        });
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
