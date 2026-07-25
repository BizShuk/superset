// editorLayoutShape — the NxM partition rules. The invariant that
// matters is `sum(shape) === groupCount`: VS Code creates empty groups
// when a descriptor has too many leaves and MERGES existing groups when
// it has too few, so a wrong sum is a visible, destructive bug.

import { describe, it, expect } from "vitest";
import {
    balancedShape,
    defaultShape,
    enumerateShapes,
    flatShape,
    formatShape,
    reconcileShape,
} from "../src/editorLayout/layoutModes";

const sum = (shape: readonly number[]): number =>
    shape.reduce((total, slot) => total + slot, 0);

describe("flatShape / balancedShape", () => {
    it("flat puts every group on the major axis", () => {
        expect(flatShape(1)).toEqual([1]);
        expect(flatShape(4)).toEqual([1, 1, 1, 1]);
        expect(flatShape(0)).toEqual([]);
    });

    it("balanced fills ceil(sqrt(n)) slots as evenly as possible", () => {
        expect(balancedShape(1)).toEqual([1]);
        expect(balancedShape(4)).toEqual([2, 2]);
        expect(balancedShape(5)).toEqual([2, 2, 1]);
        expect(balancedShape(6)).toEqual([2, 2, 2]);
        expect(balancedShape(7)).toEqual([3, 2, 2]);
        expect(balancedShape(9)).toEqual([3, 3, 3]);
        expect(balancedShape(0)).toEqual([]);
    });

    it("balanced always sums to the group count", () => {
        for (let n = 1; n <= 40; n++) {
            expect(sum(balancedShape(n)), `n=${n}`).toBe(n);
        }
    });

    it("defaultShape dispatches on the policy", () => {
        expect(defaultShape(6, "flat")).toEqual([1, 1, 1, 1, 1, 1]);
        expect(defaultShape(6, "balanced")).toEqual([2, 2, 2]);
    });
});

describe("reconcileShape", () => {
    it("leaves a matching shape untouched", () => {
        expect(reconcileShape([2, 2], 4, "flat")).toEqual([2, 2]);
        expect(reconcileShape([2, 2, 1], 5, "flat")).toEqual([2, 2, 1]);
    });

    it("grows into the smallest slot, keeping the slot count", () => {
        expect(reconcileShape([2, 2], 5, "flat")).toEqual([3, 2]);
        expect(reconcileShape([3, 1], 5, "flat")).toEqual([3, 2]);
        expect(reconcileShape([1, 1, 1], 5, "flat")).toEqual([2, 2, 1]);
    });

    it("shrinks from the largest slot and drops emptied slots", () => {
        expect(reconcileShape([2, 2, 2], 4, "flat")).toEqual([1, 1, 2]);
        expect(reconcileShape([2, 2], 2, "flat")).toEqual([1, 1]);
        expect(reconcileShape([3], 1, "flat")).toEqual([1]);
        expect(reconcileShape([1, 1, 1, 1], 2, "flat")).toEqual([1, 1]);
    });

    it("falls back to the policy shape on junk input", () => {
        expect(reconcileShape(undefined, 4, "flat")).toEqual([1, 1, 1, 1]);
        expect(reconcileShape(undefined, 4, "balanced")).toEqual([2, 2]);
        expect(reconcileShape([], 3, "flat")).toEqual([1, 1, 1]);
        expect(reconcileShape([0, 2], 3, "flat")).toEqual([1, 1, 1]);
        expect(reconcileShape([-1, 2], 3, "balanced")).toEqual([2, 1]);
        expect(reconcileShape([1.5, 2], 3, "flat")).toEqual([1, 1, 1]);
    });

    it("returns an empty shape when there are no groups", () => {
        expect(reconcileShape([2, 2], 0, "flat")).toEqual([]);
        expect(reconcileShape(undefined, -3, "flat")).toEqual([]);
    });

    it("always ends up summing to groupCount", () => {
        const shapes = [[1], [2, 2], [3, 1], [1, 1, 1], [4, 4], [2, 2, 1]];
        for (const shape of shapes) {
            for (let n = 1; n <= 20; n++) {
                const out = reconcileShape(shape, n, "flat");
                expect(sum(out), `${shape.join(",")} -> n=${n}`).toBe(n);
                expect(out.every((slot) => slot > 0)).toBe(true);
            }
        }
    });
});

describe("enumerateShapes", () => {
    it("offers the flat split, every rectangle, and the balanced shape", () => {
        // Rectangles are listed by growing slot size, so the shape with
        // the most major slots comes first.
        expect(enumerateShapes(6)).toEqual([
            [1, 1, 1, 1, 1, 1],
            [2, 2, 2],
            [3, 3],
        ]);
        expect(enumerateShapes(4)).toEqual([[1, 1, 1, 1], [2, 2]]);
        expect(enumerateShapes(5)).toEqual([[1, 1, 1, 1, 1], [2, 2, 1]]);
        expect(enumerateShapes(1)).toEqual([[1]]);
    });

    it("never offers a shape whose sum differs from the group count", () => {
        // This is the picker's entire safety guarantee: a user cannot
        // select an option that merges or spawns groups.
        for (let n = 1; n <= 24; n++) {
            for (const shape of enumerateShapes(n)) {
                expect(sum(shape), `n=${n}`).toBe(n);
            }
        }
    });

    it("returns no candidates without groups", () => {
        expect(enumerateShapes(0)).toEqual([]);
    });

    it("does not repeat a shape", () => {
        for (let n = 1; n <= 24; n++) {
            const keys = enumerateShapes(n).map((shape) => shape.join(","));
            expect(new Set(keys).size).toBe(keys.length);
        }
    });
});

describe("formatShape", () => {
    it("labels uniform grids as NxM", () => {
        expect(formatShape([2, 2])).toBe("2×2");
        expect(formatShape([3, 3])).toBe("2×3");
        expect(formatShape([2, 2, 2])).toBe("3×2");
    });

    it("labels ragged grids additively", () => {
        expect(formatShape([2, 2, 1])).toBe("2+2+1");
        expect(formatShape([3, 1])).toBe("3+1");
    });

    it("says nothing for a flat or single-group layout", () => {
        expect(formatShape([1, 1, 1])).toBe("");
        expect(formatShape([1])).toBe("");
        expect(formatShape([])).toBe("");
    });
});
