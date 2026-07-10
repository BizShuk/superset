// terminalsPlugin — `ExtensionPlugin` adapter for the Terminals
// feature. The heavy lifting (TreeView, commands, PTY factory,
// lifecycle subscriptions, drag-and-drop, watcher) still lives in
// `./index.ts` as a plain `register(ctx: FeatureContext)` function,
// unchanged from before the plugin era. This adapter builds a
// `FeatureContext` out of a `PluginContext`, hands it to `register()`,
// and bridges every disposable the legacy register pushes into
// `ctx.subscriptions` into the plugin's managed pool.
//
// The deeper refactors in `plans/architecture-terminals.md`
// (`PtyProcessController` / `TerminalLifecycleCoordinator` /
// `GroupRepository`) are not in scope for this stage:
// - `PtyProcess` is already a clean interface (see `ptyTerminalHost.ts`)
//   with `deps.spawn` injection — equivalent to a `PtyProcessController`.
// - `GroupStore` is already a pure in-memory class with no `workspaceState`
//   coupling, so a `GroupRepository` layer would be empty.
// - `TerminalLifecycleCoordinator` would require extracting ~140 lines
//   of intertwined subscription logic from `index.ts`; left for a
//   follow-up stage so the migration stays small and reversible.

import * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
    createFeatureContext,
} from "../plugin";
import { register as registerTerminalsModule } from "./index";
import type { FeatureHandle } from "../shared";

export const TERMINALS_PLUGIN_ID = "terminals";

export const terminalsPlugin: ExtensionPlugin = {
    id: TERMINALS_PLUGIN_ID,
    name: "Terminals",
    activate(pCtx: PluginContext): void {
        // Create a real StatusBarItem so HighlightPresenter can call
        // .show() / .hide() / .text on it without throwing. The fake
        // `{} as vscode.StatusBarItem` stub was missing these methods
        // and caused "FAILED to handle event" on onDidChangeActiveTerminal
        // and onDidCloseTerminal whenever the presenter tried to update it.
        const statusBar = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        pCtx.registerDisposable(statusBar);

        const fCtx = createFeatureContext(pCtx, { statusBar });
        const handle: FeatureHandle = registerTerminalsModule(fCtx);
        (
            pCtx as unknown as { __terminalsHandle?: FeatureHandle }
        ).__terminalsHandle = handle;
        pCtx.log("terminals: registered");
    },
    deactivate(): void {
        // Force-dispose of plugin-managed disposables is handled by
        // `PluginManager.deactivateAll`. Nothing extra to do here.
    },
};
