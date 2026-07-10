import type * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
    createFeatureContext,
} from "../plugin";
import { register as registerProjectsModule } from "./index";
import type { FeatureHandle } from "../shared";

export const PROJECTS_PLUGIN_ID = "projects";

export const projectsPlugin: ExtensionPlugin = {
    id: PROJECTS_PLUGIN_ID,
    name: "Projects",
    activate(pCtx: PluginContext): void {
        const fCtx = createFeatureContext(pCtx, {
            statusBar: {} as vscode.StatusBarItem,
        });
        const handle: FeatureHandle = registerProjectsModule(fCtx);
        (
            pCtx as unknown as { __projectsHandle?: FeatureHandle }
        ).__projectsHandle = handle;
        pCtx.log("projects: registered");
    },
    deactivate(): void {
        // Force-dispose of plugin-managed disposables is handled by
        // PluginManager.deactivateAll. Nothing extra to do here.
    },
};
