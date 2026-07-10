// `FeatureContext` builder for the legacy `register(ctx)` shims.
//
// Every feature whose heavy lifting still lives in a `register(ctx:
// FeatureContext)` function (todo / mdns / terminals / topology /
// projects / projectsTodo) needs to adapt a `PluginContext` into that
// legacy shape before calling `register()`. The adaptation logic is
// identical across all six — the only wrinkle is the status-bar item:
// `terminals` creates a real one (its `HighlightPresenter` calls
// `.show()` / `.hide()`), while the others tolerate a stub.
//
// Extracted from six near-verbatim duplicates so the six plugin shims
// shrink to a single `activate()` call each. The subscription-bridging
// trick (intercepting `subscriptions.push` to forward every disposable
// into the plugin's managed pool) lives here once instead of six times.

import type * as vscode from "vscode";
import type { PluginContext } from "./types";
import type { FeatureContext } from "../shared";

export interface CreateFeatureContextOptions {
    /**
     * Status-bar item surfaced to the feature via `shared.statusBar`.
     * `terminals` passes a real `vscode.StatusBarItem` (its presenter
     * updates it on activity); every other feature passes a stub
     * (`{} as vscode.StatusBarItem`) because it never touches the bar.
     */
    readonly statusBar: vscode.StatusBarItem;
}

/**
 * Adapt a `PluginContext` to the legacy `FeatureContext` shape that the
 * feature's `register()` expects. The disposable / reset-handler arrays
 * are bridged to the plugin's pools so cleanup stays correct even if
 * `register()` chooses to push to `ctx.subscriptions`.
 */
export function createFeatureContext(
    pCtx: PluginContext,
    options: CreateFeatureContextOptions
): FeatureContext {
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
            statusBar: options.statusBar,
            diag: {} as vscode.OutputChannel,
            log: pCtx.log,
        },
        resetHandlers,
    };
}
