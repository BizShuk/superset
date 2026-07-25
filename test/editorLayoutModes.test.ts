// editorLayoutModes — the pure four-mode domain. A mode is a
// COMBINATION of one sizing per direction, so the tests below check
// that each direction is honoured independently: `max-even` must widen
// the active column WITHOUT squeezing the rows inside it.

import { describe, it, expect } from "vitest";
import {
    DEFAULT_MAX_RATIO,
    FALLBACK_SET_TOTAL,
    allocateSizes,
    EDITOR_LAYOUT_MODES,
    MIN_SIBLING_SHARE,
    activeShare,
    buildLayout,
    clampMaxRatio,
    countLeaves,
    cycleMode,
    describeShape,
    directionAt,
    findLeafPath,
    flipOrientation,
    isLayoutDescriptor,
    modeOf,
    parseMode,
    restyleLayout,
    sizingFor,
    toggleSizing,
    type EditorLayoutDescriptor,
    type EditorLayoutMode,
    type GroupLayoutNode,
} from "../src/editorLayout/layoutModes";

/** Strip every size so two trees can be compared on topology alone. */
function topology(nodes: readonly GroupLayoutNode[]): unknown[] {
    return nodes.map((node) =>
        node.groups && node.groups.length
            ? { groups: topology(node.groups) }
            : {}
    );
}

/**
 * Share of its sibling set a node holds. Sizes are emitted as pixel
 * counts (see `FALLBACK_SET_TOTAL`), so every ratio assertion has to go
 * through the set total rather than reading `size` directly.
 */
function share(nodes: readonly GroupLayoutNode[], index: number): number {
    const total = nodes.reduce((sum, node) => sum + (node.size ?? 0), 0);
    return (nodes[index].size ?? 0) / total;
}

/** No sibling is squeezed below the floor, at any depth. */
function assertNoCollapse(nodes: readonly GroupLayoutNode[]): void {
    for (let i = 0; i < nodes.length; i++) {
        expect(share(nodes, i)).toBeGreaterThanOrEqual(
            MIN_SIBLING_SHARE - 0.01
        );
        const kids = nodes[i].groups;
        if (kids?.length) assertNoCollapse(kids);
    }
}

/** Every emitted size is a positive integer — VS Code works in pixels. */
function assertIntegerSizes(nodes: readonly GroupLayoutNode[]): void {
    for (const node of nodes) {
        expect(Number.isInteger(node.size)).toBe(true);
        expect(node.size!).toBeGreaterThan(0);
        if (node.groups?.length) assertIntegerSizes(node.groups);
    }
}

const flat3: EditorLayoutDescriptor = {
    orientation: 0,
    groups: [{ size: 0.2 }, { size: 0.5 }, { size: 0.3 }],
};

const grid2x2: EditorLayoutDescriptor = {
    orientation: 0,
    groups: [
        { size: 0.6, groups: [{ size: 0.4 }, { size: 0.6 }] },
        { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] },
    ],
};

const ragged: EditorLayoutDescriptor = {
    orientation: 1,
    groups: [
        { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.2 },
    ],
};

const deep3: EditorLayoutDescriptor = {
    orientation: 0,
    groups: [
        { size: 0.5 },
        {
            size: 0.5,
            groups: [
                { size: 0.5 },
                { size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] },
            ],
        },
    ],
};

describe("mode algebra", () => {
    it("is the combination of one sizing per direction", () => {
        expect(EDITOR_LAYOUT_MODES).toEqual([
            "even-even",
            "max-even",
            "even-max",
            "max-max",
        ]);
        for (const horizontal of ["even", "max"] as const) {
            for (const vertical of ["even", "max"] as const) {
                const mode = modeOf(horizontal, vertical);
                expect(EDITOR_LAYOUT_MODES).toContain(mode);
                expect(sizingFor(mode, "horizontal")).toBe(horizontal);
                expect(sizingFor(mode, "vertical")).toBe(vertical);
            }
        }
    });

    it("parses only the four literals", () => {
        for (const mode of EDITOR_LAYOUT_MODES) {
            expect(parseMode(mode)).toBe(mode);
        }
        // The previous single-axis ids must not survive an upgrade.
        expect(parseMode("h-even")).toBeUndefined();
        expect(parseMode("v-max")).toBeUndefined();
        expect(parseMode("Even-Even")).toBeUndefined();
        expect(parseMode("")).toBeUndefined();
        expect(parseMode(undefined)).toBeUndefined();
        expect(parseMode(3)).toBeUndefined();
    });

    it("toggles one direction without touching the other", () => {
        for (const mode of EDITOR_LAYOUT_MODES) {
            const h = toggleSizing(mode, "horizontal");
            expect(sizingFor(h, "horizontal")).not.toBe(
                sizingFor(mode, "horizontal")
            );
            expect(sizingFor(h, "vertical")).toBe(sizingFor(mode, "vertical"));
            expect(toggleSizing(h, "horizontal")).toBe(mode);

            const v = toggleSizing(mode, "vertical");
            expect(sizingFor(v, "vertical")).not.toBe(
                sizingFor(mode, "vertical")
            );
            expect(sizingFor(v, "horizontal")).toBe(
                sizingFor(mode, "horizontal")
            );
            expect(toggleSizing(v, "vertical")).toBe(mode);
        }
    });

    it("cycles through all four modes and returns to the start", () => {
        let mode: EditorLayoutMode = "even-even";
        const seen: EditorLayoutMode[] = [];
        for (let i = 0; i < 4; i++) {
            seen.push(mode);
            mode = cycleMode(mode);
        }
        expect(seen).toEqual(EDITOR_LAYOUT_MODES);
        expect(mode).toBe("even-even");
    });

    it("clamps maxRatio into 0.5-0.9 and falls back on junk", () => {
        expect(clampMaxRatio(0.7)).toBe(0.7);
        expect(clampMaxRatio(0.1)).toBe(0.5);
        expect(clampMaxRatio(5)).toBe(0.9);
        expect(clampMaxRatio(Number.NaN)).toBe(DEFAULT_MAX_RATIO);
        expect(clampMaxRatio("0.8")).toBe(DEFAULT_MAX_RATIO);
    });
});

describe("directionAt", () => {
    it("follows the root orientation and alternates below it", () => {
        // VS Code: "the orientation of subsequent groups is the
        // opposite of the orientation of the group that contains it".
        expect(directionAt(0, 0)).toBe("horizontal");
        expect(directionAt(1, 0)).toBe("vertical");
        expect(directionAt(2, 0)).toBe("horizontal");
        expect(directionAt(0, 1)).toBe("vertical");
        expect(directionAt(1, 1)).toBe("horizontal");
        expect(directionAt(2, 1)).toBe("vertical");
    });

    it("flipOrientation swaps which level each direction owns", () => {
        expect(flipOrientation(0)).toBe(1);
        expect(flipOrientation(1)).toBe(0);
        expect(directionAt(0, flipOrientation(0))).toBe("vertical");
    });
});

describe("activeShare", () => {
    it("hands the whole level to a lone sibling", () => {
        expect(activeShare(0.7, 1)).toBe(1);
    });

    it("uses maxRatio when every sibling still clears the floor", () => {
        expect(activeShare(0.7, 2)).toBeCloseTo(0.7, 10);
        expect(activeShare(0.7, 3)).toBeCloseTo(0.7, 10);
        expect(activeShare(0.9, 2)).toBeCloseTo(0.9, 10);
    });

    it("caps the active share so no sibling collapses", () => {
        // 5 siblings at 0.9 would leave 0.025 each — a sliver VS Code
        // clamps to its minimum group size, which reads as "gone".
        const share = activeShare(0.9, 5);
        expect((1 - share) / 4).toBeGreaterThanOrEqual(
            MIN_SIBLING_SHARE - 1e-9
        );
    });

    it("degrades to an even split rather than shrinking the active one", () => {
        expect(activeShare(0.9, 12)).toBeCloseTo(1 / 12, 10);
    });
});

describe("allocateSizes", () => {
    it("spreads a total across ratios as integers that still sum to it", () => {
        expect(allocateSizes([0.7, 0.3], 1000)).toEqual([700, 300]);
        expect(allocateSizes([0.5, 0.5], 961).reduce((a, b) => a + b, 0)).toBe(
            961
        );
        expect(allocateSizes([1 / 3, 1 / 3, 1 / 3], 100)).toEqual([34, 33, 33]);
    });

    it("never emits a zero, even for a ratio that rounds away", () => {
        const sizes = allocateSizes([0.999, 0.001], 100);
        expect(Math.min(...sizes)).toBeGreaterThan(0);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it("guarantees at least one unit per entry on a tiny budget", () => {
        const sizes = allocateSizes([0.5, 0.3, 0.2], 2);
        expect(sizes).toEqual([1, 1, 1]);
    });

    it("handles degenerate input without dividing by zero", () => {
        expect(allocateSizes([], 500)).toEqual([]);
        expect(allocateSizes([0, 0], 100)).toEqual([50, 50]);
    });
});

describe("pixel-magnitude sizes", () => {
    // `createSerializedGrid` derives the virtual grid from the SUM of
    // the sizes, so fractional sizes build a 1x1 grid in which every
    // editor group is below its minimum and gets clamped — the layout
    // then looks like siblings vanished. Sizes must stay in the same
    // pixel magnitude `getEditorLayout` handed back.
    const livePixels: EditorLayoutDescriptor = {
        orientation: 0,
        groups: [
            { size: 960, groups: [{ size: 800 }, { size: 800 }] },
            { size: 640, groups: [{ size: 800 }, { size: 800 }] },
        ],
    };

    it("emits integers, never fractions", () => {
        for (const mode of EDITOR_LAYOUT_MODES) {
            assertIntegerSizes(restyleLayout(livePixels, mode, 0, 0.7)!.groups);
        }
    });

    it("preserves each sibling set's pixel extent", () => {
        const out = restyleLayout(livePixels, "max-even", 0, 0.7)!;
        expect(out.groups.reduce((sum, n) => sum + n.size!, 0)).toBe(1600);
        for (const column of out.groups) {
            expect(column.groups!.reduce((sum, n) => sum + n.size!, 0)).toBe(
                1600
            );
        }
    });

    it("splits the live extent by the mode's ratios", () => {
        const out = restyleLayout(livePixels, "max-even", 0, 0.7)!;
        expect(out.groups[0].size).toBe(1120);
        expect(out.groups[1].size).toBe(480);
        expect(out.groups[0].groups![0].size).toBe(800);
    });

    it("falls back to a usable budget when the live sizes are unusable", () => {
        const noSizes: EditorLayoutDescriptor = {
            orientation: 0,
            groups: [{}, {}, {}],
        };
        const out = restyleLayout(noSizes, "even-even", 0, 0.7)!;
        expect(out.groups.reduce((sum, n) => sum + n.size!, 0)).toBe(
            FALLBACK_SET_TOTAL
        );
    });
});

describe("restyleLayout", () => {
    const fixtures: Array<[string, EditorLayoutDescriptor]> = [
        ["flat 3", flat3],
        ["2x2", grid2x2],
        ["ragged 2+2+1", ragged],
        ["depth 3", deep3],
    ];

    it("never changes the topology or the leaf count", () => {
        for (const [name, fixture] of fixtures) {
            for (const mode of EDITOR_LAYOUT_MODES) {
                const out = restyleLayout(fixture, mode, 1, 0.7);
                expect(out, name).toBeDefined();
                expect(topology(out!.groups), `${name} / ${mode}`).toEqual(
                    topology(fixture.groups)
                );
                expect(countLeaves(out!.groups)).toBe(
                    countLeaves(fixture.groups)
                );
            }
        }
    });

    it("preserves the live orientation unless overridden", () => {
        expect(restyleLayout(flat3, "max-max", 0, 0.7)!.orientation).toBe(0);
        expect(restyleLayout(ragged, "max-max", 0, 0.7)!.orientation).toBe(1);
        expect(restyleLayout(flat3, "even-even", 0, 0.7, 1)!.orientation).toBe(
            1
        );
    });

    it("splits every sibling set evenly in even-even", () => {
        for (const [name, fixture] of fixtures) {
            const out = restyleLayout(fixture, "even-even", 0, 0.7)!;
            assertNoCollapse(out.groups);
            const expected = 1 / fixture.groups.length;
            for (let i = 0; i < out.groups.length; i++) {
                expect(share(out.groups, i), name).toBeCloseTo(expected, 2);
            }
        }
    });

    it("max-even widens the active column and leaves its rows equal", () => {
        // The regression this whole model exists for: a 2x2 grid must
        // stay a visible 2x2, not collapse into one big editor.
        const out = restyleLayout(grid2x2, "max-even", 0, 0.7)!;
        assertNoCollapse(out.groups);

        expect(share(out.groups, 0)).toBeCloseTo(0.7, 2);
        expect(share(out.groups, 1)).toBeCloseTo(0.3, 2);
        for (const column of out.groups) {
            expect(share(column.groups!, 0)).toBeCloseTo(0.5, 2);
            expect(share(column.groups!, 1)).toBeCloseTo(0.5, 2);
        }
    });

    it("even-max heightens the active row and leaves columns equal", () => {
        const out = restyleLayout(grid2x2, "even-max", 0, 0.7)!;
        assertNoCollapse(out.groups);

        expect(share(out.groups, 0)).toBeCloseTo(0.5, 2);
        expect(share(out.groups, 1)).toBeCloseTo(0.5, 2);
        expect(share(out.groups[0].groups!, 0)).toBeCloseTo(0.7, 2);
        expect(share(out.groups[0].groups!, 1)).toBeCloseTo(0.3, 2);
        // The off-path column holds no active group, so it stays even.
        expect(share(out.groups[1].groups!, 0)).toBeCloseTo(0.5, 2);
    });

    it("max-max enlarges both directions without collapsing a sibling", () => {
        const out = restyleLayout(grid2x2, "max-max", 3, 0.7)!;
        assertNoCollapse(out.groups);
        expect(share(out.groups, 1)).toBeCloseTo(0.7, 2);
        expect(share(out.groups[1].groups!, 1)).toBeCloseTo(0.7, 2);
        // Every other group keeps 30% of its own level — visible.
        expect(share(out.groups, 0)).toBeCloseTo(0.3, 2);
    });

    it("swaps which level each sizing owns when the root is vertical", () => {
        const vertical: EditorLayoutDescriptor = {
            ...grid2x2,
            orientation: 1,
        };
        const out = restyleLayout(vertical, "max-even", 0, 0.7)!;
        // Root now splits top-to-bottom, so the VERTICAL sizing (even)
        // applies there and the horizontal max moves one level down.
        expect(share(out.groups, 0)).toBeCloseTo(0.5, 2);
        expect(share(out.groups[0].groups!, 0)).toBeCloseTo(0.7, 2);
    });

    it("never squeezes a sibling below the floor at any mode or depth", () => {
        for (const [name, fixture] of fixtures) {
            for (const mode of EDITOR_LAYOUT_MODES) {
                for (const ratio of [0.5, 0.7, 0.9]) {
                    for (
                        let active = 0;
                        active < countLeaves(fixture.groups);
                        active++
                    ) {
                        const out = restyleLayout(
                            fixture,
                            mode,
                            active,
                            ratio
                        )!;
                        expect(
                            () => assertNoCollapse(out.groups),
                            `${name} / ${mode} / ${ratio} / ${active}`
                        ).not.toThrow();
                    }
                }
            }
        }
    });

    it("clamps an out-of-range activeIndex instead of throwing", () => {
        const high = restyleLayout(grid2x2, "max-even", 99, 0.7)!;
        expect(share(high.groups, 1)).toBeCloseTo(0.7, 2);
        const low = restyleLayout(grid2x2, "max-even", -5, 0.7)!;
        expect(share(low.groups, 0)).toBeCloseTo(0.7, 2);
    });

    it("gives a lone group the whole area in every mode", () => {
        const single: EditorLayoutDescriptor = {
            orientation: 1,
            groups: [{ size: 0.3 }],
        };
        for (const mode of EDITOR_LAYOUT_MODES) {
            const out = restyleLayout(single, mode, 0, 0.7)!;
            expect(out.groups).toHaveLength(1);
            expect(share(out.groups, 0)).toBe(1);
        }
    });

    it("returns undefined for malformed or empty layouts", () => {
        expect(restyleLayout(undefined, "even-even", 0, 0.7)).toBeUndefined();
        expect(restyleLayout({}, "even-even", 0, 0.7)).toBeUndefined();
        expect(
            restyleLayout({ orientation: 0, groups: [] }, "even-even", 0, 0.7)
        ).toBeUndefined();
    });
});

describe("isLayoutDescriptor", () => {
    it("accepts well-formed descriptors", () => {
        expect(isLayoutDescriptor(flat3)).toBe(true);
        expect(isLayoutDescriptor({ orientation: 1, groups: [] })).toBe(true);
    });

    it("rejects anything the built-in command could hand back", () => {
        expect(isLayoutDescriptor(undefined)).toBe(false);
        expect(isLayoutDescriptor(null)).toBe(false);
        expect(isLayoutDescriptor("layout")).toBe(false);
        expect(isLayoutDescriptor({ groups: [] })).toBe(false);
        expect(isLayoutDescriptor({ orientation: 2, groups: [] })).toBe(false);
        expect(isLayoutDescriptor({ orientation: 0 })).toBe(false);
    });
});

describe("findLeafPath", () => {
    it("numbers leaves depth-first, matching viewColumn order", () => {
        expect(findLeafPath(grid2x2.groups, 0)).toEqual([0, 0]);
        expect(findLeafPath(grid2x2.groups, 3)).toEqual([1, 1]);
        expect(findLeafPath(ragged.groups, 4)).toEqual([2]);
        expect(findLeafPath(grid2x2.groups, 9)).toEqual([]);
    });
});

describe("buildLayout", () => {
    it("turns a partition into leaves, nesting only when needed", () => {
        expect(topology(buildLayout("even-even", [1, 1, 1], 0, 0, 0.7)!.groups))
            .toEqual([{}, {}, {}]);
        expect(topology(buildLayout("even-even", [2, 2], 0, 0, 0.7)!.groups))
            .toEqual([{ groups: [{}, {}] }, { groups: [{}, {}] }]);
        expect(topology(buildLayout("even-even", [2, 2, 1], 0, 0, 0.7)!.groups))
            .toEqual([{ groups: [{}, {}] }, { groups: [{}, {}] }, {}]);
    });

    it("produces exactly sum(shape) leaves", () => {
        for (const shape of [[1], [1, 1, 1], [2, 2], [3, 3], [2, 2, 1], [4, 2]]) {
            const out = buildLayout("even-even", shape, 1, 0, 0.7)!;
            const expected = shape.reduce((sum, slot) => sum + slot, 0);
            expect(countLeaves(out.groups)).toBe(expected);
        }
    });

    it("uses the orientation it is handed", () => {
        expect(buildLayout("even-even", [2, 2], 1, 0, 0.7)!.orientation).toBe(1);
        expect(buildLayout("even-even", [2, 2], 0, 0, 0.7)!.orientation).toBe(0);
    });

    it("keeps every sibling visible on a built grid", () => {
        const out = buildLayout("max-max", [3, 3], 0, 4, 0.75)!;
        assertNoCollapse(out.groups);
        assertIntegerSizes(out.groups);
    });

    it("falls back to a workable pixel budget with no sizes to inherit", () => {
        const out = buildLayout("even-even", [1, 1, 1, 1], 0, 0, 0.7)!;
        const total = out.groups.reduce((sum, n) => sum + (n.size ?? 0), 0);
        expect(total).toBe(FALLBACK_SET_TOTAL);
    });

    it("returns undefined for an empty shape", () => {
        expect(buildLayout("even-even", [], 0, 0, 0.7)).toBeUndefined();
    });
});

describe("describeShape", () => {
    it("counts the leaves under each root slot", () => {
        expect(describeShape(flat3)).toEqual([1, 1, 1]);
        expect(describeShape(grid2x2)).toEqual([2, 2]);
        expect(describeShape(ragged)).toEqual([2, 2, 1]);
        expect(describeShape(deep3)).toEqual([1, 3]);
    });

    it("returns an empty shape for junk input", () => {
        expect(describeShape(undefined)).toEqual([]);
        expect(describeShape({ groups: [] })).toEqual([]);
    });

    it("round-trips a shape through buildLayout", () => {
        for (const shape of [[1, 1, 1], [2, 2], [2, 2, 1], [3, 3]]) {
            expect(
                describeShape(buildLayout("even-even", shape, 0, 0, 0.7)!)
            ).toEqual(shape);
        }
    });
});
