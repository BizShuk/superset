// editorLayoutPlugin — `ExtensionPlugin` for one FIXED editor grid
// sizing rule: columns share the width evenly, and inside a column the
// active row takes the larger share.
//
// Responsibility (single reason to change): translate user intent into
// a layout descriptor. All layout maths lives in `./grid`, all
// orchestration in `./controller`, and every `vscode` call in
// `./applyLayout`.
//
// Three behaviours worth knowing before editing:
//
//  - Explicit commands apply with `force`, event-driven re-applies do
//    not. The signature guard in `LayoutController` only suppresses the
//    latter, so `Refresh Editor Layout` still re-flattens a grid whose
//    dividers were dragged by hand.
//  - The sizing rule never dictates the root orientation; the live one
//    is preserved. Only `editorLayoutTranspose` changes it.
//  - Only the shape picker may change the grid topology. Everything
//    else preserves it, which is what makes NxM grids work without the
//    feature knowing what N and M are.

import * as vscode from "vscode";
import { type ExtensionPlugin, type PluginContext } from "../plugin";
import {
    CONFIG_SECTION,
    createVscodeLayoutHost,
    readFollowActiveGroup,
    readRestoreOnActivate,
} from "./applyLayout";
import { LayoutController } from "./controller";
import { defaultShape, renderShapeLabel, type LayoutShape } from "./grid";

export const EDITOR_LAYOUT_PLUGIN_ID = "editorLayout";

/** Every command this plugin owns. Mirrored by the manifest test. */
export const EDITOR_LAYOUT_COMMANDS = {
    refresh: "superset.editorLayoutRefresh",
    transpose: "superset.editorLayoutTranspose",
    shapePick: "superset.editorLayoutShapePick",
    shapeReset: "superset.editorLayoutShapeReset",
} as const;

/** Coalesces the burst of events a single split/focus change produces. */
const FOLLOW_DEBOUNCE_MS = 80;

/** Matches `panelLayout`'s restore delay — let activation settle first. */
const RESTORE_DELAY_MS = 50;

export const editorLayoutPlugin: ExtensionPlugin = {
    id: EDITOR_LAYOUT_PLUGIN_ID,
    name: "Editor Layout",

    async activate(pCtx: PluginContext): Promise<void> {
        const host = createVscodeLayoutHost(pCtx.log);
        const controller = new LayoutController(host);

        // Re-apply the rule onto the live grid. Nothing is stored, so
        // the only thing that can pull rule and screen apart is the
        // screen: dividers dragged by hand, or a setting that feeds the
        // maths (`maxRatio`) changing. Dropping the memo first is what
        // stops the signature guard from suppressing the write.
        const refreshLayout = async (): Promise<void> => {
            controller.reset();
            await controller.apply({ force: true });
        };

        const register = (
            command: string,
            handler: () => void | Promise<void>
        ): void => {
            pCtx.registerDisposable(
                vscode.commands.registerCommand(command, handler)
            );
        };

        register(EDITOR_LAYOUT_COMMANDS.refresh, () => refreshLayout());

        register(EDITOR_LAYOUT_COMMANDS.transpose, async () => {
            await controller.transpose();
        });

        register(EDITOR_LAYOUT_COMMANDS.shapePick, async () => {
            const candidates = controller.candidateShapes();
            if (!candidates.length) {
                void vscode.window.showInformationMessage(
                    "Superset: no editor groups to reshape."
                );
                return;
            }
            // Every candidate sums to the live group count, so picking
            // one can never spawn an empty group or merge an existing
            // one. That filtering is the whole safety story of this
            // command — do not widen the list.
            const current = (await controller.currentShape()).join(",");
            const picked = await vscode.window.showQuickPick(
                candidates.map((shape) => ({
                    label: `${
                        shape.join(",") === current ? "$(check) " : ""
                    }${renderShapeLabel(shape)}`,
                    description: `${shape.join(" + ")} groups`,
                    shape,
                })),
                { placeHolder: "Superset: pick an editor grid shape" }
            );
            if (picked) {
                await controller.applyShape(picked.shape as LayoutShape);
            }
        });

        register(EDITOR_LAYOUT_COMMANDS.shapeReset, async () => {
            const shape = defaultShape(host.groupCount(), host.shapePolicy());
            await controller.applyShape(shape);
        });

        // The max direction has to follow focus, otherwise the enlarged
        // row is whichever one happened to be active when the layout
        // was last applied.
        let timer: ReturnType<typeof setTimeout> | undefined;

        const onGridChanged = (): void => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                void (async () => {
                    if (readFollowActiveGroup()) await controller.apply();
                })();
            }, FOLLOW_DEBOUNCE_MS);
        };

        pCtx.registerDisposable(
            vscode.window.tabGroups.onDidChangeTabGroups(onGridChanged)
        );
        pCtx.registerDisposable(
            vscode.window.onDidChangeActiveTextEditor(onGridChanged)
        );
        // A setting change is a silent divergence: nothing about the
        // grid changed, so no grid event fires, yet the numbers the
        // layout is built from just moved.
        pCtx.registerDisposable(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration(CONFIG_SECTION)) return;
                void refreshLayout();
            })
        );
        pCtx.registerDisposable({
            dispose: () => {
                if (timer) clearTimeout(timer);
            },
        });

        pCtx.registerResetHandler(() => controller.reset());

        // Restoring only rewrites sizes — orientation and grid shape
        // both survive, so a grid the user built by hand comes back
        // exactly as they left it.
        setTimeout(() => {
            void (async () => {
                if (readRestoreOnActivate() && host.groupCount() > 0) {
                    await controller.apply({ force: true });
                }
            })();
        }, RESTORE_DELAY_MS);

        pCtx.log("editorLayout: registered (horizontal even, vertical max)");
    },

    deactivate(): void {
        // Commands and event subscriptions are all registered as
        // disposables and released by the PluginManager.
    },
};
