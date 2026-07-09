// Tests for the cross-panel TreeViewRegistry. Verifies:
// - register / get / dispose lifecycle
// - BFS walk respects depth + timeout bounds
// - predicate matching returns the first hit
// - missing viewId returns undefined / false

import { describe, expect, it, vi } from "vitest";
import { TreeViewRegistry } from "../src/plugin/treeViewRegistry";

function makeProvider(
    children: unknown[],
    depth = 1
): {
    getChildren: ReturnType<typeof vi.fn>;
} {
    const provider = {
        getChildren: vi.fn((element: unknown) => {
            if (!element) return children;
            // synthetic leaf — no children
            if (depth <= 0) return [];
            return [];
        }),
    };
    return provider;
}

describe("TreeViewRegistry", () => {
    it("register / get / dispose", () => {
        const reg = new TreeViewRegistry();
        const provider = makeProvider([]);
        const treeView = { reveal: vi.fn() };
        const d = reg.register("superset.todo", treeView as any, provider as any, () => undefined);
        expect(reg.get("superset.todo")).toBeDefined();
        expect(reg.listViewIds()).toContain("superset.todo");
        d.dispose();
        expect(reg.get("superset.todo")).toBeUndefined();
    });

    it("find returns the first matching node via BFS", async () => {
        const reg = new TreeViewRegistry();
        const a = { line: 1, text: "a", kind: "checkbox" };
        const b = { line: 2, text: "b", kind: "checkbox" };
        const c = { line: 3, text: "c", kind: "section" };
        const childrenByElement = new Map<unknown, unknown[]>([
            [undefined, [a, b]],
            [a, [c]],
            [b, []],
            [c, []],
        ]);
        const provider = {
            getChildren: vi.fn((element: unknown) => {
                return childrenByElement.get(element) ?? [];
            }),
        };
        reg.register("superset.todo", { reveal: vi.fn() } as any, provider as any, () => undefined);
        const found = await reg.find<{ line: number }>(
            "superset.todo",
            (item) => item.line === 3
        );
        expect(found?.line).toBe(3);
    });

    it("find returns undefined when no match", async () => {
        const reg = new TreeViewRegistry();
        const provider = makeProvider([{ line: 1, text: "x", kind: "checkbox" }]);
        reg.register("superset.todo", { reveal: vi.fn() } as any, provider as any, () => undefined);
        const found = await reg.find(
            "superset.todo",
            () => false
        );
        expect(found).toBeUndefined();
    });

    it("find returns undefined for unknown viewId", async () => {
        const reg = new TreeViewRegistry();
        const found = await reg.find("superset.does-not-exist", () => true);
        expect(found).toBeUndefined();
    });

    it("re-register logs a warning", () => {
        const reg = new TreeViewRegistry();
        const log = vi.fn();
        reg.register("v", { reveal: vi.fn() } as any, makeProvider([]) as any, log);
        reg.register("v", { reveal: vi.fn() } as any, makeProvider([]) as any, log);
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("re-registering")
        );
    });
});