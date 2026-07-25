// editorLayoutPlugin — `ExtensionPlugin` for the four editor-layout
// modes: a combination of one sizing per direction,
// `{horizontal: even|max} x {vertical: even|max}`.
//
// Responsibility (single reason to change): translate user intent into
// a layout descriptor and keep the status bar honest. All layout maths
// lives in `./layoutModes`, all orchestration in `./controller`, and
// every `vscode` call in `./applyLayout`.
//
// Three behaviours worth knowing before editing:
//
//  - Explicit commands apply with `force`, event-driven re-applies do
//    not. The signature guard in `LayoutController` only suppresses the
//    latter, so pressing a mode command after dragging a divider still
//    re-flattens the grid.
//  - The mode never dictates the root orientation; the live one is
//    preserved. Only `editorLayoutTranspose` changes it.
//  - Only the shape picker may change the grid topology. Everything
//    else preserves it, which is what makes NxM grids work without the
//    feature knowing what N and M are.

import * as vscode from "vscode";
import { type ExtensionPlugin, type PluginContext } from "../plugin";
import {
    createVscodeLayoutHost,
    readFollowActiveGroup,
    readRestoreOnActivate,
} from "./applyLayout";
import { LayoutController } from "./controller";
import {
    DEFAULT_EDITOR_LAYOUT_MODE,
    cycleMode,
    defaultShape,
    sizingFor,
    toggleSizing,
    type EditorLayoutMode,
    type LayoutShape,
} from "./layoutModes";
import { readLayoutMode, writeLayoutMode } from "./modeStorage";
import {
    renderModeChoices,
    renderShapeLabel,
    renderStatus,
} from "./statusBar";

export const EDITOR_LAYOUT_PLUGIN_ID = "editorLayout";

/** Every command this plugin owns. Mirrored by the manifest test. */
export const EDITOR_LAYOUT_COMMANDS = {
    even: "superset.editorLayoutEven",
    maxHorizontal: "superset.editorLayoutMaxHorizontal",
    maxVertical: "superset.editorLayoutMaxVertical",
    maxBoth: "superset.editorLayoutMaxBoth",
    toggleHorizontal: "superset.editorLayoutToggleHorizontal",
    toggleVertical: "superset.editorLayoutToggleVertical",
    transpose: "superset.editorLayoutTranspose",
    cycle: "superset.editorLayoutCycle",
    pick: "superset.editorLayoutPick",
    shapePick: "superset.editorLayoutShapePick",
    shapeReset: "superset.editorLayoutShapeReset",
} as const;

/** Coalesces the burst of events a single split/focus change produces. */
const FOLLOW_DEBOUNCE_MS = 80;

/** Matches `panelLayout`'s restore delay — let activation settle first. */
const RESTORE_DELAY_MS = 50;

export const editorLayoutPlugin: ExtensionPlugin = {
    id: EDITOR_LAYOUT_PLUGIN_ID,
    name: "Editor Layout Modes",

    async activate(pCtx: PluginContext): Promise<void> {
        const host = createVscodeLayoutHost(pCtx.log);
        const controller = new LayoutController(host);

        let mode: EditorLayoutMode =
            readLayoutMode(pCtx.workspaceState) ?? DEFAULT_EDITOR_LAYOUT_MODE;

        const statusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        statusItem.command = EDITOR_LAYOUT_COMMANDS.pick;
        pCtx.registerDisposable(statusItem);

        const refreshStatus = async (): Promise<void> => {
            if (host.groupCount() < 1) {
                statusItem.hide();
                return;
            }
            const [shape, orientation] = await Promise.all([
                controller.currentShape(),
                controller.currentOrientation(),
            ]);
            const render = renderStatus(
                mode,
                shape,
                orientation,
                host.maxRatio()
            );
            statusItem.text = render.text;
            statusItem.tooltip = render.tooltip;
            statusItem.show();
        };

        const setMode = async (next: EditorLayoutMode): Promise<void> => {
            mode = next;
            await writeLayoutMode(pCtx.workspaceState, next);
            await controller.applyMode(next, { force: true });
            await refreshStatus();
        };

        const register = (
            command: string,
            handler: () => void | Promise<void>
        ): void => {
            pCtx.registerDisposable(
                vscode.commands.registerCommand(command, handler)
            );
        };

        register(EDITOR_LAYOUT_COMMANDS.even, () => setMode("even-even"));
        register(EDITOR_LAYOUT_COMMANDS.maxHorizontal, () =>
            setMode("max-even")
        );
        register(EDITOR_LAYOUT_COMMANDS.maxVertical, () => setMode("even-max"));
        register(EDITOR_LAYOUT_COMMANDS.maxBoth, () => setMode("max-max"));
        register(EDITOR_LAYOUT_COMMANDS.toggleHorizontal, () =>
            setMode(toggleSizing(mode, "horizontal"))
        );
        register(EDITOR_LAYOUT_COMMANDS.toggleVertical, () =>
            setMode(toggleSizing(mode, "vertical"))
        );
        register(EDITOR_LAYOUT_COMMANDS.cycle, () => setMode(cycleMode(mode)));

        register(EDITOR_LAYOUT_COMMANDS.transpose, async () => {
            await controller.transpose(mode);
            await refreshStatus();
        });

        register(EDITOR_LAYOUT_COMMANDS.pick, async () => {
            const choices = renderModeChoices(host.maxRatio());
            const picked = await vscode.window.showQuickPick(
                choices.map((choice) => ({
                    label: `${choice.mode === mode ? "$(check) " : ""}${choice.label}`,
                    description: choice.description,
                    mode: choice.mode,
                })),
                { placeHolder: "Superset: pick an editor layout mode" }
            );
            if (picked) await setMode(picked.mode);
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
                await controller.applyShape(mode, picked.shape as LayoutShape);
                await refreshStatus();
            }
        });

        register(EDITOR_LAYOUT_COMMANDS.shapeReset, async () => {
            const shape = defaultShape(host.groupCount(), host.shapePolicy());
            await controller.applyShape(mode, shape);
            await refreshStatus();
        });

        // A `max` direction needs to follow focus, otherwise the
        // enlarged group is whichever one happened to be active when
        // the mode was set. `even-even` deliberately does not re-apply:
        // dividers the user dragged by hand stay where they put them
        // until the next explicit command.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const followsFocus = (): boolean =>
            sizingFor(mode, "horizontal") === "max" ||
            sizingFor(mode, "vertical") === "max";

        const onGridChanged = (): void => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                void (async () => {
                    if (followsFocus() && readFollowActiveGroup()) {
                        await controller.applyMode(mode);
                    }
                    await refreshStatus();
                })();
            }, FOLLOW_DEBOUNCE_MS);
        };

        pCtx.registerDisposable(
            vscode.window.tabGroups.onDidChangeTabGroups(onGridChanged)
        );
        pCtx.registerDisposable(
            vscode.window.onDidChangeActiveTextEditor(onGridChanged)
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
                    await controller.applyMode(mode, { force: true });
                }
                await refreshStatus();
            })();
        }, RESTORE_DELAY_MS);

        pCtx.log(`editorLayout: registered (mode=${mode})`);
    },

    deactivate(): void {
        // Status bar item, commands and event subscriptions are all
        // registered as disposables and released by the PluginManager.
    },
};
