// editorLayoutController — orchestration against a fake host. The two
// behaviours pinned here are the ones that would silently break the
// feature in the extension host: the anti-feedback-loop guard, and the
// promise that only the reshape path ever changes the leaf count.

import { describe, it, expect } from "vitest";
import {
    LayoutController,
    layoutSignature,
    type LayoutHost,
} from "../src/editorLayout/controller";
import {
    countLeaves,
    type EditorLayoutDescriptor,
    type ShapePolicy,
} from "../src/editorLayout/grid";

interface FakeHost extends LayoutHost {
    writes: EditorLayoutDescriptor[];
    logs: string[];
    layout: unknown;
    index: number;
    count: number;
}

function makeHost(
    layout: unknown,
    options: { index?: number; count?: number; policy?: ShapePolicy } = {}
): FakeHost {
    const host: FakeHost = {
        writes: [],
        logs: [],
        layout,
        index: options.index ?? 0,
        count:
            options.count ??
            (layout && typeof layout === "object" && "groups" in layout
                ? countLeaves((layout as EditorLayoutDescriptor).groups)
                : 0),
        readLayout: async () => host.layout,
        writeLayout: async (descriptor) => {
            host.writes.push(descriptor);
            // Mimic VS Code: the applied layout becomes the live one.
            host.layout = descriptor;
        },
        activeIndex: () => host.index,
        groupCount: () => host.count,
        maxRatio: () => 0.7,
        shapePolicy: () => options.policy ?? "flat",
        log: (message) => host.logs.push(message),
    };
    return host;
}

/** Share of its sibling set a node holds — sizes are emitted in pixels. */
function share(
    nodes: readonly { size?: number }[],
    index: number
): number {
    const total = nodes.reduce((sum, node) => sum + (node.size ?? 0), 0);
    return (nodes[index].size ?? 0) / total;
}

const grid2x2: EditorLayoutDescriptor = {
    orientation: 0,
    groups: [
        { size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] },
    ],
};

describe("layoutSignature", () => {
    it("ignores floating-point noise below the rounding threshold", () => {
        const a: EditorLayoutDescriptor = {
            orientation: 0,
            groups: [{ size: 0.5 }, { size: 0.5 }],
        };
        const b: EditorLayoutDescriptor = {
            orientation: 0,
            groups: [{ size: 0.50000001 }, { size: 0.49999999 }],
        };
        expect(layoutSignature(a)).toBe(layoutSignature(b));
    });

    it("separates different orientations and different trees", () => {
        const flat: EditorLayoutDescriptor = {
            orientation: 0,
            groups: [{ size: 0.5 }, { size: 0.5 }],
        };
        expect(layoutSignature(flat)).not.toBe(
            layoutSignature({ ...flat, orientation: 1 })
        );
        expect(layoutSignature(flat)).not.toBe(layoutSignature(grid2x2));
    });
});

describe("LayoutController.apply", () => {
    it("preserves the topology AND the orientation of an NxM grid", async () => {
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);

        await controller.apply({ force: true });

        expect(host.writes).toHaveLength(1);
        const written = host.writes[0];
        expect(written.orientation).toBe(0);
        expect(countLeaves(written.groups)).toBe(4);
        expect(written.groups).toHaveLength(2);
        expect(written.groups.every((node) => node.groups?.length === 2)).toBe(
            true
        );
    });

    it("suppresses an unforced repeat — the anti-loop guard", async () => {
        // `vscode.setEditorLayout` itself fires the tab-group change
        // event, so an unguarded listener would apply forever.
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);

        expect(await controller.apply()).toBe(true);
        expect(await controller.apply()).toBe(false);
        expect(host.writes).toHaveLength(1);
    });

    it("still suppresses when the host clamps the applied sizes", async () => {
        // The guard compares against what WE last wrote, never against
        // the live layout: VS Code enforces minimum group sizes, so the
        // two legitimately differ and comparing them would loop.
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);

        await controller.apply();
        host.layout = {
            orientation: 0,
            groups: [
                { size: 0.62, groups: [{ size: 0.62 }, { size: 0.38 }] },
                { size: 0.38, groups: [{ size: 0.5 }, { size: 0.5 }] },
            ],
        };

        expect(await controller.apply()).toBe(false);
        expect(host.writes).toHaveLength(1);
    });

    it("re-applies when forced, so a command still beats a manual drag", async () => {
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);

        await controller.apply();
        expect(await controller.apply({ force: true })).toBe(true);
        expect(host.writes).toHaveLength(2);
    });

    it("re-applies unforced when the active group moves", async () => {
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);

        await controller.apply();
        host.index = 3;
        expect(await controller.apply()).toBe(true);
        expect(host.writes).toHaveLength(2);
    });

    it("no-ops without editor groups and keeps quiet", async () => {
        const host = makeHost(grid2x2, { count: 0 });
        const controller = new LayoutController(host);

        expect(await controller.apply({ force: true })).toBe(
            false
        );
        expect(host.writes).toHaveLength(0);
    });

    it("no-ops and logs when the layout command yields junk", async () => {
        const host = makeHost(undefined, { count: 2 });
        const controller = new LayoutController(host);

        expect(await controller.apply({ force: true })).toBe(
            false
        );
        expect(host.writes).toHaveLength(0);
        expect(host.logs.join("\n")).toContain("vscode.getEditorLayout");
    });

    it("reset clears the memo so the next unforced apply writes", async () => {
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);

        await controller.apply();
        controller.reset();
        expect(await controller.apply()).toBe(true);
        expect(host.writes).toHaveLength(2);
    });
});

describe("LayoutController.transpose", () => {
    it("flips the root orientation without touching the tree", async () => {
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);

        expect(await controller.transpose()).toBe(true);

        const written = host.writes[0];
        expect(written.orientation).toBe(1);
        expect(countLeaves(written.groups)).toBe(4);
        expect(written.groups).toHaveLength(2);
        expect(written.groups.every((node) => node.groups?.length === 2)).toBe(
            true
        );
    });

    it("moves the max to the level the flip hands it", async () => {
        // Root was horizontal, so the columns split evenly and the max
        // lived one level in. After the transpose the root splits
        // top-to-bottom, so the max moves up to the root.
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);

        await controller.apply({ force: true });
        expect(share(host.writes[0].groups, 0)).toBeCloseTo(0.5, 2);
        expect(share(host.writes[0].groups[0].groups!, 0)).toBeCloseTo(0.7, 2);

        await controller.transpose();
        const after = host.writes[1];
        expect(after.orientation).toBe(1);
        expect(share(after.groups, 0)).toBeCloseTo(0.7, 2);
        expect(share(after.groups[0].groups!, 0)).toBeCloseTo(0.5, 2);
    });

    it("returns to the original orientation when applied twice", async () => {
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);

        await controller.transpose();
        await controller.transpose();
        expect(host.writes[1].orientation).toBe(0);
    });

    it("no-ops when the layout command yields junk", async () => {
        const host = makeHost(undefined, { count: 4 });
        const controller = new LayoutController(host);

        expect(await controller.transpose()).toBe(false);
        expect(host.writes).toHaveLength(0);
    });
});

describe("LayoutController.applyShape", () => {
    it("reshapes to the requested partition, keeping the orientation", async () => {
        const host = makeHost({ ...grid2x2, orientation: 1 });
        const controller = new LayoutController(host);

        await controller.applyShape([1, 1, 1, 1]);

        const written = host.writes[0];
        expect(written.groups).toHaveLength(4);
        expect(countLeaves(written.groups)).toBe(4);
        expect(written.orientation).toBe(1);
    });

    it("reconciles a mismatched shape instead of merging groups", async () => {
        // A shape summing to 6 against 4 live groups would make VS Code
        // spawn two empty groups; reconciliation trims it first.
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);

        await controller.applyShape([3, 3]);

        expect(countLeaves(host.writes[0].groups)).toBe(4);
    });

    it("no-ops without editor groups", async () => {
        const host = makeHost(grid2x2, { count: 0 });
        const controller = new LayoutController(host);

        expect(await controller.applyShape([2, 2])).toBe(false);
        expect(host.writes).toHaveLength(0);
    });

    it("primes the guard so the follow listener does not re-apply", async () => {
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);

        await controller.applyShape([1, 1, 1, 1]);
        expect(await controller.apply()).toBe(false);
    });
});

describe("LayoutController introspection", () => {
    it("reports the live shape", async () => {
        const host = makeHost(grid2x2);
        const controller = new LayoutController(host);
        expect(await controller.currentShape()).toEqual([2, 2]);
    });

    it("offers only shapes matching the live group count", () => {
        const host = makeHost(grid2x2, { count: 6 });
        const controller = new LayoutController(host);
        for (const shape of controller.candidateShapes()) {
            expect(shape.reduce((sum, slot) => sum + slot, 0)).toBe(6);
        }
    });
});
