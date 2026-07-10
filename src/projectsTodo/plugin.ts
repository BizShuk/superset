import type * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
    createFeatureContext,
} from "../plugin";
import { register as registerProjectsTodoModule } from "./index";
import type { FeatureHandle } from "../shared";

export const PROJECTS_TODO_PLUGIN_ID = "projectsTodo";

export const projectsTodoPlugin: ExtensionPlugin = {
    id: PROJECTS_TODO_PLUGIN_ID,
    name: "Projects TODO",
    activate(pCtx: PluginContext): void {
        const fCtx = createFeatureContext(pCtx, {
            statusBar: {} as vscode.StatusBarItem,
        });
        const handle: FeatureHandle = registerProjectsTodoModule(fCtx);
        (pCtx as unknown as { __projectsTodoHandle?: FeatureHandle }).__projectsTodoHandle =
            handle;
        pCtx.log("projectsTodo: registered");
    },
    deactivate(): void {
        // Managed disposables are torn down automatically by PluginManager
    },
};
