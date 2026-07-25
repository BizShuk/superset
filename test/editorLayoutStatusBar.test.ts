// editorLayoutStatusBar — pure rendering of every user-facing string.
// Both directions are always shown, because a mode is a combination:
// showing only the "active" one would hide half the state.

import { describe, it, expect } from "vitest";
import {
    renderModeChoices,
    renderModeLabel,
    renderShapeLabel,
    renderStatus,
} from "../src/editorLayout/statusBar";
import { EDITOR_LAYOUT_MODES } from "../src/editorLayout/layoutModes";

describe("renderModeLabel", () => {
    it("spells out both directions for every mode", () => {
        expect(renderModeLabel("even-even")).toBe("H·Even V·Even");
        expect(renderModeLabel("max-even")).toBe("H·Max V·Even");
        expect(renderModeLabel("even-max")).toBe("H·Even V·Max");
        expect(renderModeLabel("max-max")).toBe("H·Max V·Max");
    });
});

describe("renderStatus", () => {
    it("shows the mode label with the layout icon", () => {
        expect(renderStatus("max-even", [1, 1], 0, 0.7).text).toBe(
            "$(editor-layout) H·Max V·Even"
        );
        expect(renderStatus("even-max", [1, 1], 0, 0.7).text).toBe(
            "$(editor-layout) H·Even V·Max"
        );
    });

    it("appends the grid shape only when it is not a plain split", () => {
        expect(renderStatus("max-max", [2, 2], 0, 0.7).text).toBe(
            "$(editor-layout) H·Max V·Max 2×2"
        );
        expect(renderStatus("even-even", [2, 2, 1], 0, 0.7).text).toBe(
            "$(editor-layout) H·Even V·Even 2+2+1"
        );
        expect(renderStatus("even-even", [1, 1, 1], 0, 0.7).text).toBe(
            "$(editor-layout) H·Even V·Even"
        );
        expect(renderStatus("even-even", [], 0, 0.7).text).toBe(
            "$(editor-layout) H·Even V·Even"
        );
    });

    it("never uses the split codicon, whose direction is inverted", () => {
        for (const mode of EDITOR_LAYOUT_MODES) {
            const { text } = renderStatus(mode, [2, 2], 0, 0.7);
            expect(text).not.toContain("split-horizontal");
            expect(text).not.toContain("split-vertical");
        }
    });

    it("names the root split direction in the tooltip", () => {
        expect(renderStatus("even-even", [1, 1], 0, 0.7).tooltip).toContain(
            "root splits left to right"
        );
        expect(renderStatus("even-even", [1, 1], 1, 0.7).tooltip).toContain(
            "root splits top to bottom"
        );
    });

    it("describes each direction's sizing separately", () => {
        const tooltip = renderStatus("max-even", [1, 1], 0, 0.75).tooltip;
        expect(tooltip).toContain("left-right: active group takes up to 75%");
        expect(tooltip).toContain("top-bottom: equal shares");
    });

    it("mentions the grid in the tooltip when there is one", () => {
        expect(renderStatus("max-max", [2, 2], 0, 0.7).tooltip).toContain(
            "grid 2×2"
        );
        expect(renderStatus("max-max", [1, 1], 0, 0.7).tooltip).not.toContain(
            "grid"
        );
    });
});

describe("renderModeChoices", () => {
    it("offers all four combinations in cycle order", () => {
        const choices = renderModeChoices(0.7);
        expect(choices.map((choice) => choice.mode)).toEqual(
            EDITOR_LAYOUT_MODES
        );
    });

    it("labels each choice with both directions and a plain-words gloss", () => {
        const choices = renderModeChoices(0.7);
        expect(choices[0].label).toContain("H·Even V·Even");
        expect(choices[0].label).toContain("Even — both directions");
        expect(choices[1].label).toContain("Max horizontal — even vertical");
        expect(choices[3].description).toContain("70%");
    });
});

describe("renderShapeLabel", () => {
    it("names grids and falls back for a flat split", () => {
        expect(renderShapeLabel([2, 2])).toBe("2×2");
        expect(renderShapeLabel([2, 2, 1])).toBe("2+2+1");
        expect(renderShapeLabel([1, 1, 1])).toBe("3 × 1");
        expect(renderShapeLabel([1])).toBe("1 × 1");
    });
});
