// panelLayoutPlugin — `ExtensionPlugin` for panel-layout persistence.
//
// Responsibility (single reason to change): remember the last-active
// sub-view inside the `superset` view container and restore it on
// next activation. See
// `plans/2026-07-05-architecture-panel-layout-persistence.md`.
//
// Architecture:
//  - Storage: workspaceState[`superset.activeViewId`] = viewId
//  - Capture: panels call `superset.reportViewVisible` from their
//    `onDidChangeVisibility` handler. The command validates against
//    a whitelist (see ./layoutStorage) before persisting.
//  - Restore: on activate, read the stored viewId and execute
//    `${viewId}.focus` via `vscode.commands`. The focus call is
//    scheduled via `setTimeout` so all sibling view plugins finish
//    `createTreeView` first (plan §7 risk-1). Both the focus call
//    and the panel call go through try/catch in either module so a
//    hidden/removed view can't break activation (plan §7 risk-2).
//
// Activation order contract: `panelLayoutPlugin` MUST be appended
// LAST to the `plugins` array in `extension.ts` after every other
// view plugin. The setTimeout delay is a belt-and-suspenders fallback
// in case a future edit reorders them.

import * as vscode from "vscode";
import {
    type ExtensionPlugin,
    type PluginContext,
} from "../plugin";
import {
    TRACKED_VIEW_IDS,
    readActiveViewId,
    writeActiveViewId,
} from "./layoutStorage";
import { tryRestore, type RestoreTarget } from "./restoreView";

export const PANEL_LAYOUT_PLUGIN_ID = "panelLayout";

/** VSCode command plugins call from `onDidChangeVisibility`. */
const REPORT_VIEW_VISIBLE_CMD = "superset.reportViewVisible";

/** ms to wait after activation before attempting restore. Plan §7
 *  risk-1: while view plugins are sequentially activated via the
 *  manager, the schedule guarantees all `createTreeView` calls have
 *  returned before we try to focus any of them. */
const RESTORE_DELAY_MS = 50;

export const panelLayoutPlugin: ExtensionPlugin = {
    id: PANEL_LAYOUT_PLUGIN_ID,
    name: "Panel Layout Persistence",

    async activate(pCtx: PluginContext): Promise<void> {
        // 1. Register the report command. The handler sanitises the
        //    input (whitelist) before persisting, so panels can pass
        //    whatever they like — junk viewIds are silently dropped.
        pCtx.registerDisposable(
            vscode.commands.registerCommand(
                REPORT_VIEW_VISIBLE_CMD,
                async (viewId: unknown) => {
                    await writeActiveViewId(pCtx.workspaceState, viewId as string);
                }
            )
        );

        // 2. Schedule restore AFTER every plugin has finished
        //    activating. setTimeout inside an `async activate()`
        //    returns control immediately so the rest of the activation
        //    chain (e.g. globalCommands plugin's `activate()`) keeps
        //    moving while the timer fires.
        const targets: Map<string, RestoreTarget> = new Map(
            TRACKED_VIEW_IDS.map((viewId) => [
                viewId,
                {
                    focus: () =>
                        vscode.commands.executeCommand(`${viewId}.focus`),
                },
            ])
        );

        const stored = readActiveViewId(pCtx.workspaceState);
        setTimeout(() => {
            void tryRestore(stored, targets, pCtx.log);
        }, RESTORE_DELAY_MS);

        pCtx.log(
            `panelLayout: registered (stored viewId=${stored ?? "<none>"})`
        );
    },

    deactivate(): void {
        // All disposables (the `reportViewVisible` command) are released
        // by the PluginManager. Nothing extra to do.
    },
};
