// modifiedFilesPlugin — `ExtensionPlugin` adapter for the Modified Files
// feature. The heavy lifting (TreeView creation, git spawn, FSW watcher,
// store wiring) lives in `./index.ts` as a plain `register(ctx:
// FeatureContext)` function. This adapter builds a `FeatureContext` out
// of a `PluginContext`, hands it to `register()`, and routes disposables
// through the plugin pool so `PluginManager.deactivateAll` can tear them
// down.

import type * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
    createFeatureContext,
} from "../plugin";
import { register as registerModifiedFilesModule } from "./index";
import type { FeatureHandle } from "../shared";

export const MODIFIED_FILES_PLUGIN_ID = "modified-files";

export const modifiedFilesPlugin: ExtensionPlugin = {
    id: MODIFIED_FILES_PLUGIN_ID,
    name: "Modified Files",
    activate(pCtx: PluginContext): void {
        const fCtx = createFeatureContext(pCtx, {
            statusBar: {} as vscode.StatusBarItem,
        });
        const handle: FeatureHandle = registerModifiedFilesModule(fCtx);
        // Bridge FeatureHandle.dispose: per-feature disposables are *also*
        // registered through the plugin pool above, so the manager's
        // teardown covers them. Keep a reference for explicit teardown.
        (pCtx as unknown as { __modifiedFilesHandle?: FeatureHandle }).__modifiedFilesHandle =
            handle;
        pCtx.log("modifiedFiles: registered");
    },
    deactivate(): void {
        // Plugin-managed disposables are torn down by `PluginManager.deactivateAll`.
    },
};
