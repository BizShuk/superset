import * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
} from "../plugin";
import { register as registerProjectsModule } from "./index";
import type { FeatureContext, FeatureHandle } from "../shared";

export const PROJECTS_PLUGIN_ID = "projects";

function buildFeatureContext(pCtx: PluginContext): FeatureContext {
    const subscriptions: vscode.Disposable[] = [];
    const resetHandlers: (() => void | Promise<void>)[] = [];

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

export const projectsPlugin: ExtensionPlugin = {
    id: PROJECTS_PLUGIN_ID,
    name: "Projects",
    activate(pCtx: PluginContext): void {
        const fCtx = buildFeatureContext(pCtx);
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
