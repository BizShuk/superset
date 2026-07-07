import * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
} from "../plugin";
import { register as registerProjectsTodoModule } from "./index";
import type { FeatureContext, FeatureHandle } from "../shared";

export const PROJECTS_TODO_PLUGIN_ID = "projectsTodo";

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

export const projectsTodoPlugin: ExtensionPlugin = {
    id: PROJECTS_TODO_PLUGIN_ID,
    name: "Projects TODO",
    activate(pCtx: PluginContext): void {
        const fCtx = buildFeatureContext(pCtx);
        const handle: FeatureHandle = registerProjectsTodoModule(fCtx);
        (pCtx as unknown as { __projectsTodoHandle?: FeatureHandle }).__projectsTodoHandle =
            handle;
        pCtx.log("projectsTodo: registered");
    },
    deactivate(): void {
        // Managed disposables are torn down automatically by PluginManager
    },
};
