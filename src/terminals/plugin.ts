// terminalsPlugin — adapter for the Terminals feature (legacy
// `register` shape). The only feature that creates a real
// `StatusBarItem` because `HighlightPresenter` calls `.show()` /
// `.hide()` / `.text` on it from `onDidChangeActiveTerminal` and
// `onDidCloseTerminal` handlers — a stub would throw on those.
//
// Heavy lifting (TreeView, commands, PTY factory, lifecycle
// subscriptions, drag-and-drop, watcher) still lives in `./index.ts`
// as a plain `register(ctx: FeatureContext)` function. This adapter
// builds a `FeatureContext` out of a `PluginContext`, hands it to
// `register()`, and bridges every disposable the legacy register
// pushes into `ctx.subscriptions` into the plugin's managed pool.
//
// Deeper refactors (`PtyProcessController` / `TerminalLifecycleCoordinator`
// / `GroupRepository`) listed in `plans/architecture-terminals.md`
// remain out of scope here:
// - `PtyProcess` is already a clean interface (`ptyTerminalHost.ts`)
//   with `deps.spawn` injection — equivalent to a `PtyProcessController`.
// - `GroupStore` is pure in-memory with no `workspaceState` coupling,
//   so a `GroupRepository` layer would be empty.
// - `TerminalLifecycleCoordinator` would require extracting ~140
//   lines of intertwined subscription logic from `index.ts`; left
//   for a follow-up stage.

import * as vscode from "vscode";
import { legacyPluginWithStatusBar } from "../plugin";
import { register as registerTerminalsModule } from "./index";

export const TERMINALS_PLUGIN_ID = "terminals";

export const terminalsPlugin = legacyPluginWithStatusBar({
    id: TERMINALS_PLUGIN_ID,
    name: "Terminals",
    register: registerTerminalsModule,
    createStatusBarItem: () =>
        vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        ),
});