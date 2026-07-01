// PluginManager — orchestrates plugin lifecycle with error isolation.
// Each plugin's `activate()` runs inside its own try-catch; a failure
// is logged and tagged in workspaceState but never blocks siblings.

import type * as vscode from "vscode";
import { createPluginContext, type BaseContext } from "./context";
import type { ExtensionPlugin, MarkdownIt, PluginContext } from "./types";

export class PluginManager {
    private activePlugins = new Map<string, ExtensionPlugin>();
    private contexts = new Map<string, PluginContext>();
    /** Disposables registered by each plugin, keyed by plugin id. */
    private disposables = new Map<string, vscode.Disposable[]>();
    /** Reset handlers registered by each plugin, keyed by plugin id. */
    private resetHandlers = new Map<string, (() => void | Promise<void>)[]>();

    constructor(private readonly base: BaseContext) {}

    /**
     * Activate every plugin sequentially. Sequential (not parallel) so
     * plugin order remains deterministic — important for plugins that
     * contribute commands with stable menu positions.
     */
    async activateAll(
        plugins: ExtensionPlugin[],
        extCtx: vscode.ExtensionContext
    ): Promise<void> {
        for (const plugin of plugins) {
            const disposables: vscode.Disposable[] = [];
            const resetHandlers: (() => void | Promise<void>)[] = [];
            this.disposables.set(plugin.id, disposables);
            this.resetHandlers.set(plugin.id, resetHandlers);

            try {
                const ctx = createPluginContext(
                    this.base,
                    resetHandlers,
                    disposables
                );
                await plugin.activate(ctx);
                this.activePlugins.set(plugin.id, plugin);
                this.contexts.set(plugin.id, ctx);
                this.base.log(`plugin activated: ${plugin.id}`);
            } catch (err) {
                this.markFailed(plugin.id, err);
            }
        }
    }

    /**
     * Build a markdown-it extension that composes every plugin's
     * `contributeMarkdownIt` in activation order. Returns `undefined`
     * when no plugin contributes, so the caller can fall back to the
     * legacy `createTreePreviewExtension()` shape.
     */
    getMarkdownExtension(): { extendMarkdownIt(md: MarkdownIt): MarkdownIt } | undefined {
        const contributors: NonNullable<ExtensionPlugin["contributeMarkdownIt"]>[] = [];
        for (const plugin of this.activePlugins.values()) {
            if (plugin.contributeMarkdownIt) {
                contributors.push(plugin.contributeMarkdownIt.bind(plugin));
            }
        }
        if (contributors.length === 0) return undefined;

        return {
            extendMarkdownIt(md: MarkdownIt) {
                let current = md;
                for (const contribute of contributors) {
                    current = contribute(current);
                }
                return current;
            },
        };
    }

    /**
     * Run every registered reset handler sequentially. Per-handler
     * failures are logged and swallowed so one broken handler does not
     * skip the rest.
     */
    async resetAll(): Promise<void> {
        for (const [pluginId, handlers] of this.resetHandlers) {
            for (const handler of handlers) {
                try {
                    await handler();
                } catch (err) {
                    this.base.log(
                        `reset handler from ${pluginId} threw: ${err}`
                    );
                }
            }
        }
    }

    /**
     * Deactivate every plugin in reverse activation order, force-
     * disposing all collected disposables. Errors are logged but not
     * rethrown — teardown should be best-effort.
     */
    async deactivateAll(): Promise<void> {
        const plugins = Array.from(this.activePlugins.values()).reverse();
        for (const plugin of plugins) {
            try {
                await plugin.deactivate?.();
            } catch (err) {
                this.base.log(
                    `plugin ${plugin.id} deactivate() threw: ${err}`
                );
            }

            const disposables = this.disposables.get(plugin.id) ?? [];
            for (const d of disposables) {
                try {
                    d.dispose();
                } catch (err) {
                    this.base.log(
                        `disposable from ${plugin.id} threw on dispose: ${err}`
                    );
                }
            }
        }
        this.activePlugins.clear();
        this.contexts.clear();
        this.disposables.clear();
        this.resetHandlers.clear();
    }

    /** Test/diagnostic accessor — has this plugin finished activation? */
    has(id: string): boolean {
        return this.activePlugins.has(id);
    }

    /** Test accessor — disposables registered by a given plugin. */
    getDisposables(id: string): readonly vscode.Disposable[] {
        return this.disposables.get(id) ?? [];
    }

    private markFailed(id: string, err: unknown): void {
        this.base.log(
            `plugin ${id} failed to activate: ${
                err instanceof Error ? err.message : String(err)
            }`
        );
        // Mark failure persistently so subsequent activations can avoid
        // re-running a known-broken plugin. The key is namespaced under
        // `plugin.failed.*` to coexist with the cache-reset sweep.
        this.base.extensionContext?.workspaceState.update(
            `plugin.failed.${id}`,
            true
        );
    }
}
