// PluginContext factory — turns the raw `vscode.ExtensionContext` plus
// the composition root's shared resources into a `PluginContext` that
// hides the global disposable array behind `registerDisposable()`.

import type * as vscode from "vscode";
import type { PluginContext } from "./types";

export interface BaseContext {
    readonly extensionContext: vscode.ExtensionContext;
    readonly workspaceFolder: string;
    readonly log: (msg: string) => void;
    readonly showStatus: (text: string, tooltip?: string) => void;
}

/**
 * Build a `PluginContext` bound to a single plugin. The returned object
 * collects disposables into a plugin-local array; the manager later
 * flushes them on deactivation.
 *
 * `registerResetHandler` writes to a shared array so the manager can
 * fan out a single reset command to all plugins.
 */
export function createPluginContext(
    base: BaseContext,
    resetHandlers: (() => void | Promise<void>)[],
    disposables: vscode.Disposable[]
): PluginContext {
    return {
        workspaceFolder: base.workspaceFolder,
        extensionUri: base.extensionContext.extensionUri,
        globalState: base.extensionContext.globalState,
        workspaceState: base.extensionContext.workspaceState,
        log: base.log,
        showStatus: base.showStatus,
        registerDisposable: (d) => {
            disposables.push(d);
        },
        registerResetHandler: (h) => {
            resetHandlers.push(h);
        },
    };
}
