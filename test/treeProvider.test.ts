import { describe, it, expect, vi } from "vitest";
import { buildTreeItemSpec, buildGroupSpec, COLOR_GLYPH } from "../src/treeSpec";
import type { TerminalHandle } from "../src/types";
import type { Group } from "../src/groupStore";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

describe("buildTreeItemSpec", () => {
    it("returns default icon and no description when not unseen", () => {
        const t = fakeTerminal("claude");
        const spec = buildTreeItemSpec(t, { isUnseen: false });
        expect(spec.label).toBe("claude");
        expect(spec.iconKind).toBe("default");
        expect(spec.description).toBeUndefined();
        expect(spec.command?.command).toBe("superset.focus");
        expect(spec.command?.arguments).toEqual([t]);
    });

    it("returns highlighted icon and description when unseen", () => {
        const t = fakeTerminal("claude");
        const spec = buildTreeItemSpec(t, { isUnseen: true });
        expect(spec.iconKind).toBe("highlighted");
        expect(spec.description).toBe("● 新輸出");
    });

    it("strips leading '● ' from terminal name for label", () => {
        // Presenter may have already prefixed the name; panel should show
        // the logical name without the prefix.
        const t = fakeTerminal("● claude");
        const spec = buildTreeItemSpec(t, { isUnseen: false });
        expect(spec.label).toBe("claude");
    });

    it("does not strip '● ' from middle of name", () => {
        const t = fakeTerminal("claude●test");
        const spec = buildTreeItemSpec(t, { isUnseen: false });
        expect(spec.label).toBe("claude●test");
    });

    it("tags every item with contextValue 'terminal' for inline menu", () => {
        // The package.json `menus.view.item.context` entry targets
        // `viewItem == terminal`; this discriminator must always be set
        // so the inline [X] close button appears on hover.
        const t = fakeTerminal("claude");
        const spec = buildTreeItemSpec(t, { isUnseen: false });
        expect(spec.contextValue).toBe("terminal");
    });
});

describe("buildGroupSpec", () => {
    function fakeGroup(overrides: Partial<Group> = {}): Group {
        return {
            id: "g-test",
            name: "Frontend",
            color: "blue",
            collapsed: false,
            terminals: [],
            ...overrides,
        };
    }

    it("renders color glyph + name as label", () => {
        const g = fakeGroup({ color: "red" });
        const spec = buildGroupSpec(g, { unseenCount: 0 });
        expect(spec.label).toBe(`${COLOR_GLYPH["red"]}  Frontend`);
    });

    it("shows empty description when no unseen", () => {
        const g = fakeGroup();
        const spec = buildGroupSpec(g, { unseenCount: 0 });
        expect(spec.description).toBe("");
        expect(spec.iconKind).toBe("group");
    });

    it("shows unseen count in description when unseen > 0", () => {
        const g = fakeGroup();
        const spec = buildGroupSpec(g, { unseenCount: 3 });
        expect(spec.description).toBe("● 3 個新輸出");
        expect(spec.iconKind).toBe("groupHighlighted");
    });

    it("mirrors group.collapsed in collapsibleState", () => {
        const expanded = buildGroupSpec(fakeGroup({ collapsed: false }), { unseenCount: 0 });
        expect(expanded.collapsibleState).toBe("expanded");

        const collapsed = buildGroupSpec(fakeGroup({ collapsed: true }), { unseenCount: 0 });
        expect(collapsed.collapsibleState).toBe("collapsed");
    });

    it("contextValue is always 'group'", () => {
        const g = fakeGroup();
        const spec = buildGroupSpec(g, { unseenCount: 0 });
        expect(spec.contextValue).toBe("group");
    });

    it("id is stable and prefixed", () => {
        const g = fakeGroup({ id: "my-id" });
        const spec = buildGroupSpec(g, { unseenCount: 0 });
        expect(spec.id).toBe("group:my-id");
    });
});
