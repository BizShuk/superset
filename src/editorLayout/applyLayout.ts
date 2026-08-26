// editorLayout/applyLayout — the only `vscode`-bound piece of the
// feature: it turns the injected `LayoutHost` contract into real
// built-in command calls.
//
// `vscode.getEditorLayout` and `vscode.setEditorLayout` are BUILT-IN
// COMMANDS, not typed API — `@types/vscode` declares neither, so the
// argument and the result are both unchecked at compile time. Every
// call is wrapped, and the result is structurally validated by
// `restyleLayout` before anything is written back.

import * as vscode from "vscode";
import type { EditorLayoutDescriptor, ShapePolicy } from "./grid";
import { clampMaxRatio } from "./grid";
import type { LayoutHost } from "./controller";

export const GET_EDITOR_LAYOUT_COMMAND = "vscode.getEditorLayout";
export const SET_EDITOR_LAYOUT_COMMAND = "vscode.setEditorLayout";

export const CONFIG_SECTION = "superset.editorLayout";

/**
 * Depth-first index of the active group inside the layout tree.
 *
 * `viewColumn - 1` is the ONLY correct source. VS Code resolves a view
 * column through `getGroups(GRID_APPEARANCE)`, which is the same
 * depth-first walk that produces the `groups` array of a layout
 * descriptor. `vscode.window.tabGroups.all` is ordered by group
 * CREATION instead, and the two diverge as soon as the user splits or
 * moves a group — indexing with `all.indexOf(activeTabGroup)` would
 * then enlarge the wrong group in `max` mode.
 */
export function readActiveIndex(): number {
    const column = vscode.window.tabGroups.activeTabGroup?.viewColumn;
    if (typeof column !== "number" || !Number.isFinite(column)) return 0;
    return Math.max(0, column - 1);
}

/** Build the host the `LayoutController` runs against. */
export function createVscodeLayoutHost(
    log: (message: string) => void
): LayoutHost {
    return {
        async readLayout(): Promise<unknown> {
            try {
                return await vscode.commands.executeCommand(
                    GET_EDITOR_LAYOUT_COMMAND
                );
            } catch (err) {
                log(`editorLayout: ${GET_EDITOR_LAYOUT_COMMAND} failed — ${err}`);
                return undefined;
            }
        },

        async writeLayout(descriptor: EditorLayoutDescriptor): Promise<void> {
            try {
                await vscode.commands.executeCommand(
                    SET_EDITOR_LAYOUT_COMMAND,
                    descriptor
                );
            } catch (err) {
                log(`editorLayout: ${SET_EDITOR_LAYOUT_COMMAND} failed — ${err}`);
            }
        },

        activeIndex: readActiveIndex,

        groupCount: () => vscode.window.tabGroups.all.length,

        maxRatio: () =>
            clampMaxRatio(
                vscode.workspace
                    .getConfiguration(CONFIG_SECTION)
                    .get<number>("maxRatio")
            ),

        shapePolicy: (): ShapePolicy =>
            vscode.workspace
                .getConfiguration(CONFIG_SECTION)
                .get<string>("defaultShape") === "balanced"
                ? "balanced"
                : "flat",

        log,
    };
}

/** `superset.editorLayout.followActiveGroup`. */
export function readFollowActiveGroup(): boolean {
    return (
        vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .get<boolean>("followActiveGroup") !== false
    );
}

/** `superset.editorLayout.restoreOnActivate`. */
export function readRestoreOnActivate(): boolean {
    return (
        vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .get<boolean>("restoreOnActivate") !== false
    );
}
