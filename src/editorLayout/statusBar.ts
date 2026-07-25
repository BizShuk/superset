// editorLayout/statusBar — pure renderers for every user-facing string
// of the editor-layout feature: the status-bar item and the two Quick
// Pick lists. No `vscode` import, so the wording is unit-testable.
//
// Icon note: `$(split-horizontal)` is deliberately avoided. That codicon
// depicts the SPLIT direction, which runs opposite to how this feature
// names its axes, so reusing it would reintroduce exactly the ambiguity
// `docs/terminology.md` exists to settle. `$(editor-layout)` is neutral.

import {
    EDITOR_LAYOUT_MODES,
    formatShape,
    sizingFor,
    type EditorLayoutMode,
    type LayoutOrientation,
    type LayoutShape,
    type LayoutSizing,
} from "./layoutModes";

export interface StatusRender {
    text: string;
    tooltip: string;
}

export interface ModeChoice {
    mode: EditorLayoutMode;
    label: string;
    description: string;
}

function sizingLabel(sizing: LayoutSizing): string {
    return sizing === "max" ? "Max" : "Even";
}

/** `H·Max V·Even` — both directions are always shown, never just one. */
export function renderModeLabel(mode: EditorLayoutMode): string {
    return (
        `H·${sizingLabel(sizingFor(mode, "horizontal"))} ` +
        `V·${sizingLabel(sizingFor(mode, "vertical"))}`
    );
}

function sizingPhrase(sizing: LayoutSizing, maxRatio: number): string {
    return sizing === "max"
        ? `active group takes up to ${Math.round(maxRatio * 100)}%`
        : "equal shares";
}

function modeDescription(mode: EditorLayoutMode, maxRatio: number): string {
    return (
        `left-right: ${sizingPhrase(sizingFor(mode, "horizontal"), maxRatio)}; ` +
        `top-bottom: ${sizingPhrase(sizingFor(mode, "vertical"), maxRatio)}`
    );
}

/**
 * Status-bar text such as `$(editor-layout) H·Max V·Even 2×2`. The shape
 * suffix comes from the live grid, so it disappears for a plain split
 * and shows `2+2+1` for a ragged one.
 */
export function renderStatus(
    mode: EditorLayoutMode,
    shape: LayoutShape,
    orientation: LayoutOrientation,
    maxRatio: number
): StatusRender {
    const suffix = formatShape(shape);
    const text = `$(editor-layout) ${renderModeLabel(mode)}${
        suffix ? ` ${suffix}` : ""
    }`;
    const axis =
        orientation === 0
            ? "root splits left to right"
            : "root splits top to bottom";
    const grid = suffix ? `, grid ${suffix}` : "";
    return {
        text,
        tooltip:
            `Superset Editor Layout — ${modeDescription(mode, maxRatio)}.\n` +
            `${axis}${grid}.\n` +
            "Click to pick a layout mode.",
    };
}

/** The four modes as Quick Pick rows, in cycle order. */
export function renderModeChoices(maxRatio: number): ModeChoice[] {
    const labels: Record<EditorLayoutMode, string> = {
        "even-even": "Even — both directions",
        "max-even": "Max horizontal — even vertical",
        "even-max": "Even horizontal — max vertical",
        "max-max": "Max — both directions",
    };
    return EDITOR_LAYOUT_MODES.map((mode) => ({
        mode,
        label: `${renderModeLabel(mode)}  ·  ${labels[mode]}`,
        description: modeDescription(mode, maxRatio),
    }));
}

/**
 * Human-readable label for one candidate shape. Falls back to `N × 1`
 * for a flat split, where `formatShape` deliberately says nothing.
 */
export function renderShapeLabel(shape: LayoutShape): string {
    const formatted = formatShape(shape);
    return formatted || `${shape.length} × 1`;
}
