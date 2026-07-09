// Plugin system core types — the contract every feature module fulfils
// to participate in the unified `PluginManager` lifecycle. This file is
// deliberately `vscode`-free apart from the type imports, so plugin
// adapters can be unit-tested without spinning up the extension host.

import type * as vscode from "vscode";

/**
 * Controlled dependencies handed to a plugin at activation time.
 * Wraps the global `vscode.ExtensionContext` plus the shared resources
 * owned by the composition root (status bar, log channel), so plugins
 * never reach for ambient singletons directly.
 */
export interface PluginContext {
    /** First workspace folder, or `process.cwd()` if none is open. */
    readonly workspaceFolder: string;

    /** Extension's root URI, useful for resolving webview assets. */
    readonly extensionUri: vscode.Uri;

    /** VSCode-managed per-extension global state (shared across workspaces). */
    readonly globalState: vscode.Memento;

    /** VSCode-managed per-workspace state. */
    readonly workspaceState: vscode.Memento;

    /** Diagnostic log — also surfaced via `Superset: Show Logs`. */
    log(message: string): void;

    /** Update the shared status-bar item text/tooltip. */
    showStatus(text: string, tooltip?: string): void;

    /**
     * Register a disposable that the manager will release when the
     * plugin is deactivated. Plugins should push every long-lived
     * resource (commands, watchers, event subscriptions) through here
     * rather than reaching for `vscode.ExtensionContext.subscriptions`.
     */
    registerDisposable(disposable: vscode.Disposable): void;

    /**
     * Register a cache-reset handler. Invoked when the user runs
     * `Superset: Reset Caches`; the manager awaits all handlers
     * sequentially with per-handler error isolation.
     */
    registerResetHandler(handler: () => void | Promise<void>): void;

    /**
     * Register a `vscode.TreeView` + `TreeDataProvider` with the
     * shared `TreeViewRegistry` so the `superset.revealInTree`
     * command can walk this panel's tree. Returns a disposable
     * the caller is expected to push through `registerDisposable`
     * so deactivation clears the entry.
     */
    registerTreeView(
        viewId: string,
        treeView: vscode.TreeView<unknown>,
        treeDataProvider: vscode.TreeDataProvider<unknown>
    ): vscode.Disposable;
}

/**
 * The unified contract every feature module implements. The shape is
 * intentionally minimal — plugins that don't contribute Markdown
 * preview hooks omit `contributeMarkdownIt`, and plugins without
 * per-instance state omit `deactivate`.
 */
export interface ExtensionPlugin {
    /** Stable id used as Map key and for failure markers in workspaceState. */
    readonly id: string;

    /** Human-readable name, surfaced in diagnostics / future UI. */
    readonly name: string;

    /**
     * Initialise the plugin. The manager awaits this; throwing here
     * marks the plugin as failed but does NOT abort the activation of
     * siblings (error boundary).
     */
    activate(ctx: PluginContext): void | Promise<void>;

    /**
     * Optional teardown. The manager also force-disposes every
     * registered disposable, so most plugins can leave this undefined.
     */
    deactivate?(): void | Promise<void>;

    /**
     * Optional markdown-it contribution. The manager collects these
     * from all plugins and returns the merged chain from `activate()`
     * via `getMarkdownExtension()`.
     */
    contributeMarkdownIt?(md: MarkdownIt): MarkdownIt;
}

/**
 * Minimal markdown-it surface the preview plugin chain touches. We keep
 * this loose (`any` would be too loose, but a full type would pull in
 * `markdown-it` as a hard dependency) — adapters that need more
 * structure can import the real package.
 */
export interface MarkdownIt {
    renderer: { rules: { fence?: FenceRule } };
    utils: { escapeHtml(s: string): string };
}

export type FenceRule = (
    tokens: unknown[],
    idx: number,
    options: unknown,
    env: unknown,
    self: unknown
) => string;
