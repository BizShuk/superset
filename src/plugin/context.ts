// PluginContext factory — turns the raw `vscode.ExtensionContext` plus
// the composition root's shared resources into a `PluginContext` that
// hides the global disposable array behind `registerDisposable()`.

import type * as vscode from "vscode";
import type {
    PluginContext,
    RuntimeDiagnostics,
    RuntimeDiagnosticsProvider,
} from "./types";
import type { TreeViewRegistry } from "./treeViewRegistry";

export interface BaseContext {
    readonly extensionContext: vscode.ExtensionContext;
    readonly workspaceFolder: string;
    readonly log: (msg: string) => void;
    readonly showLogs: () => void;
    readonly createTerminal: PluginContext["createTerminal"];
    readonly treeViewRegistry: TreeViewRegistry;
}

export interface PluginContextBindings {
    readonly registerDisposable: (disposable: vscode.Disposable) => void;
    readonly registerResetHandler: (
        handler: () => void | Promise<void>
    ) => void;
    readonly registerDiagnosticsProvider: (
        provider: RuntimeDiagnosticsProvider
    ) => void;
    readonly resetAll: () => Promise<void>;
    readonly getRuntimeDiagnostics: () => RuntimeDiagnostics;
}

/**
 * Build a `PluginContext` bound to a single plugin. The returned object
 * collects disposables into a plugin-local array; the manager later
 * flushes them on deactivation.
 *
 * `registerResetHandler` writes to a shared array so the manager can
 * fan out a single reset command to all plugins.
 *
 * `registerTreeView` wires the panel's `vscode.TreeView` +
 * `TreeDataProvider` into the shared `TreeViewRegistry`. Panels that
 * don't own a TreeView (e.g. globalCommands) can ignore this.
 */
export function createPluginContext(
    base: BaseContext,
    bindings: PluginContextBindings
): PluginContext {
    return {
        workspaceFolder: base.workspaceFolder,
        extensionUri: base.extensionContext.extensionUri,
        globalState: base.extensionContext.globalState,
        workspaceState: base.extensionContext.workspaceState,
        log: base.log,
        showLogs: base.showLogs,
        createTerminal: base.createTerminal,
        registerDisposable: bindings.registerDisposable,
        registerResetHandler: bindings.registerResetHandler,
        resetAll: bindings.resetAll,
        registerDiagnosticsProvider: bindings.registerDiagnosticsProvider,
        getRuntimeDiagnostics: bindings.getRuntimeDiagnostics,
        registerTreeView: (viewId, treeView, treeDataProvider) => {
            bindings.registerDisposable(
                base.treeViewRegistry.register(
                    viewId,
                    treeView,
                    treeDataProvider,
                    base.log
                )
            );
        },
        revealInTree: (viewId, predicate) =>
            base.treeViewRegistry.reveal(viewId, predicate, base.log),
    };
}
