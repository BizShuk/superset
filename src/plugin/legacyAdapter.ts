// `legacyPlugin` — adapter factory for the six pre-plugin feature
// modules whose public surface is still a plain
// `register(ctx: FeatureContext): FeatureHandle` function. The
// `ExtensionPlugin` shape (`activate(pCtx) / deactivate()` +
// disposable pool + reset handlers) wraps that legacy function so
// `PluginManager.activateAll` can manage it uniformly.
//
// Two flavours:
//   - `legacyPlugin(...)` — most features. They don't touch the
//     status bar; we pass a stub.
//   - `legacyPluginWithStatusBar(...)` — `terminals`. The caller
//     supplies a `createStatusBarItem` callback (which is where
//     `vscode` is imported), so this module itself stays
//     `vscode`-free and tests that don't mock the full `vscode`
//     surface can still load it.
//
// `vscode` is intentionally absent from the top-level imports here.
// `pluginManager.test.ts` only does `import type * as vscode` — a
// value import would fail to resolve.

import type { ExtensionPlugin, PluginContext } from "./types";
import { createFeatureContext } from "./featureContext";
import type { FeatureContext, FeatureHandle } from "../shared";

export interface LegacyPluginOptions {
    /** Stable id used by `when` clauses and workspaceState keys. */
    id: string;
    /** Human-readable name surfaced in error messages and logs. */
    name: string;
    /** The feature's `register(ctx: FeatureContext)` entry point. */
    register: (ctx: FeatureContext) => FeatureHandle;
}

/**
 * Build an `ExtensionPlugin` for a feature whose `register` doesn't
 * touch the status bar. Status bar is stubbed.
 *
 * Replaces the six near-identical shims in
 * `src/<feature>/plugin.ts` (mdns / todo / projects / projectsTodo /
 * topology) with a single factory call.
 */
export function legacyPlugin(options: LegacyPluginOptions): ExtensionPlugin {
    return {
        id: options.id,
        name: options.name,
        activate(pCtx: PluginContext): void {
            const fCtx = createFeatureContext(pCtx, {
                statusBar: {} as import("vscode").StatusBarItem,
            });
            const handle = options.register(fCtx);
            // Keep a back-reference so a future Stage 6 migration
            // (which will rewrite the feature's `register` to take
            // a `PluginContext` directly) can still find the handle
            // if any caller reaches into it.
            (
                pCtx as unknown as Record<string, FeatureHandle | undefined>
            )[`__${options.id}Handle`] = handle;
            pCtx.log(`${options.id}: registered`);
        },
        deactivate(): void {
            // Managed disposables are torn down by
            // `PluginManager.deactivateAll`.
        },
    };
}

export interface LegacyPluginWithStatusBarOptions extends LegacyPluginOptions {
    /**
     * Factory called once during `activate` to build the
     * `StatusBarItem` shared with the feature via
     * `ctx.shared.statusBar`. Returned item is registered as a
     * plugin-managed disposable so it is disposed on deactivate.
     * The caller imports `vscode` and supplies this closure; that
     * keeps `legacyAdapter.ts` itself free of `vscode` imports so
     * tests that only mock `vscode` per-file still work.
     */
    createStatusBarItem: () => import("vscode").StatusBarItem;
}

/**
 * Build an `ExtensionPlugin` that also exposes a real `StatusBarItem`
 * to the feature via `ctx.shared.statusBar`. Used by `terminals`
 * (its `HighlightPresenter` updates the bar on terminal activity).
 */
export function legacyPluginWithStatusBar(
    options: LegacyPluginWithStatusBarOptions,
): ExtensionPlugin {
    return {
        id: options.id,
        name: options.name,
        activate(pCtx: PluginContext): void {
            const statusBar = options.createStatusBarItem();
            pCtx.registerDisposable(statusBar);
            const fCtx = createFeatureContext(pCtx, { statusBar });
            const handle = options.register(fCtx);
            (
                pCtx as unknown as Record<string, FeatureHandle | undefined>
            )[`__${options.id}Handle`] = handle;
            pCtx.log(`${options.id}: registered`);
        },
        deactivate(): void {
            // Managed disposables are torn down by
            // `PluginManager.deactivateAll`.
        },
    };
}
