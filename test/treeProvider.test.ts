import { describe, it, expect, vi } from "vitest";
import { buildTreeItemSpec } from "../src/treeSpec";
import type { TerminalHandle } from "../src/types";

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
