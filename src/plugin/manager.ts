// PluginManager — orchestrates plugin lifecycle with error isolation.
// Each plugin's `activate()` runs inside its own try-catch; a failure
// is logged and cleaned up but never blocks siblings.

import type * as vscode from "vscode";
import { createPluginContext, type BaseContext } from "./context";
import type {
    ExtensionPlugin,
    MarkdownIt,
    RuntimeDiagnostics,
    RuntimeDiagnosticsProvider,
} from "./types";

export class PluginManager {
    private activePlugins = new Map<string, ExtensionPlugin>();
    /** Disposables registered by each plugin, keyed by plugin id. */
    private disposables = new Map<string, vscode.Disposable[]>();
    /** Reset handlers registered by each plugin, keyed by plugin id. */
    private resetHandlers = new Map<string, (() => void | Promise<void>)[]>();
    /** Live diagnostic provider registered by each plugin. */
    private diagnosticsProviders = new Map<
        string,
        RuntimeDiagnosticsProvider
    >();

    constructor(private readonly base: BaseContext) {}

    /**
     * Activate every plugin sequentially. Sequential (not parallel) so
     * plugin order remains deterministic — important for plugins that
     * contribute commands with stable menu positions.
     */
    async activateAll(plugins: ExtensionPlugin[]): Promise<void> {
        for (const plugin of plugins) {
            const disposables: vscode.Disposable[] = [];
            const resetHandlers: (() => void | Promise<void>)[] = [];
            this.disposables.set(plugin.id, disposables);
            this.resetHandlers.set(plugin.id, resetHandlers);

            try {
                const ctx = createPluginContext(this.base, {
                    registerDisposable: (disposable) => {
                        disposables.push(disposable);
                    },
                    registerResetHandler: (handler) => {
                        resetHandlers.push(handler);
                    },
                    registerDiagnosticsProvider: (provider) => {
                        this.diagnosticsProviders.set(plugin.id, provider);
                    },
                    resetAll: () => this.resetAll(),
                    getRuntimeDiagnostics: () =>
                        this.getRuntimeDiagnostics(),
                });
                await plugin.activate(ctx);
                this.activePlugins.set(plugin.id, plugin);
                this.base.log(`plugin activated: ${plugin.id}`);
            } catch (err) {
                this.markFailed(plugin.id, err);
                // Activation may fail after a command, watcher, socket, or
                // timer has already been registered. A failed plugin is not
                // added to activePlugins, so waiting until deactivateAll()
                // would otherwise skip those partial resources forever.
                await this.deactivatePlugin(plugin, disposables);
                this.diagnosticsProviders.delete(plugin.id);
                this.disposables.delete(plugin.id);
                this.resetHandlers.delete(plugin.id);
            }
        }
    }

    /**
     * Build a markdown-it extension that composes every plugin's
     * `contributeMarkdownIt` in activation order. Returns `undefined`
     * when no plugin contributes.
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

    /** Build one live, fail-soft snapshot of the active runtime. */
    getRuntimeDiagnostics(): RuntimeDiagnostics {
        const metrics: Record<string, number> = {};
        for (const [pluginId, provider] of this.diagnosticsProviders) {
            if (!this.activePlugins.has(pluginId)) continue;
            try {
                Object.assign(metrics, provider());
            } catch (err) {
                this.base.log(
                    `diagnostics provider from ${pluginId} threw: ${err}`
                );
            }
        }
        return {
            activePluginIds: [...this.activePlugins.keys()],
            metrics,
        };
    }

    /**
     * Deactivate every plugin in reverse activation order, force-
     * disposing all collected disposables. Errors are logged but not
     * rethrown — teardown should be best-effort.
     */
    async deactivateAll(): Promise<void> {
        const plugins = Array.from(this.activePlugins.values()).reverse();
        for (const plugin of plugins) {
            const disposables = this.disposables.get(plugin.id) ?? [];
            await this.deactivatePlugin(plugin, disposables);
            this.diagnosticsProviders.delete(plugin.id);
        }
        this.activePlugins.clear();
        this.disposables.clear();
        this.resetHandlers.clear();
        this.diagnosticsProviders.clear();
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
    }

    private async deactivatePlugin(
        plugin: ExtensionPlugin,
        disposables: readonly vscode.Disposable[]
    ): Promise<void> {
        try {
            await plugin.deactivate?.();
        } catch (err) {
            this.base.log(
                `plugin ${plugin.id} deactivate() threw: ${err}`
            );
        }

        // Dispose each identity once in reverse registration order so
        // dependants release before the resources they depend on.
        for (const disposable of [...new Set(disposables)].reverse()) {
            try {
                disposable.dispose();
            } catch (err) {
                this.base.log(
                    `disposable from ${plugin.id} threw on dispose: ${err}`
                );
            }
        }
    }
}
