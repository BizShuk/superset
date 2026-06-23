import { describe, it, expect, vi } from "vitest";
import { GroupStore, UNGROUPED_ID, type GroupColor } from "../src/groupStore";
import type { TerminalHandle } from "../src/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

describe("GroupStore", () => {
    it("starts with a single default group", () => {
        const gs = new GroupStore();
        const groups = gs.getGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0].id).toBe(UNGROUPED_ID);
        expect(groups[0].name).toBe("(Ungrouped)");
        expect(groups[0].terminals).toEqual([]);
    });

    // ── createGroup ──────────────────────────────────────

    it("emits groupAdded on createGroup()", () => {
        const gs = new GroupStore();
        const listener = vi.fn();
        gs.onDidChange(listener);

        const group = gs.createGroup("Frontend");

        expect(listener).toHaveBeenCalledWith({
            type: "groupAdded",
            group,
        });
        expect(group.name).toBe("Frontend");
        expect(group.color).toBe("blue");
        expect(group.collapsed).toBe(false);
        expect(gs.getGroups()).toHaveLength(2);
    });

    it("new group appears after the default group", () => {
        const gs = new GroupStore();
        gs.createGroup("A");
        gs.createGroup("B");

        const groups = gs.getGroups();
        expect(groups[0].id).toBe(UNGROUPED_ID);
        expect(groups[1].name).toBe("A");
        expect(groups[2].name).toBe("B");
    });

    // ── assignDefaultGroup ───────────────────────────────

    it("assignDefaultGroup puts terminal into the default group", () => {
        const gs = new GroupStore();
        const t = fakeTerminal("bash");
        const listener = vi.fn();
        gs.onDidChange(listener);

        gs.assignDefaultGroup(t);

        expect(listener).toHaveBeenCalledWith({
            type: "terminalAssigned",
            terminal: t,
            groupId: UNGROUPED_ID,
        });
        const def = gs.getGroup(UNGROUPED_ID)!;
        expect(def.terminals).toContain(t);
    });

    it("assignDefaultGroup is idempotent", () => {
        const gs = new GroupStore();
        const t = fakeTerminal("bash");
        gs.assignDefaultGroup(t);

        const listener = vi.fn();
        gs.onDidChange(listener);
        gs.assignDefaultGroup(t);

        expect(listener).not.toHaveBeenCalled();
        const def = gs.getGroup(UNGROUPED_ID)!;
        expect(def.terminals.filter((x) => x === t)).toHaveLength(1);
    });

    // ── removeTerminal ───────────────────────────────────

    it("removeTerminal clears the reverse map and removes from group", () => {
        const gs = new GroupStore();
        const t = fakeTerminal("bash");
        gs.assignDefaultGroup(t);
        const listener = vi.fn();
        gs.onDidChange(listener);

        gs.removeTerminal(t);

        expect(listener).toHaveBeenCalledWith({
            type: "terminalUnassigned",
            terminal: t,
        });
        const def = gs.getGroup(UNGROUPED_ID)!;
        expect(def.terminals).not.toContain(t);
    });

    it("removeTerminal is no-op for unknown terminal", () => {
        const gs = new GroupStore();
        const t = fakeTerminal("ghost");
        const listener = vi.fn();
        gs.onDidChange(listener);

        gs.removeTerminal(t);

        expect(listener).not.toHaveBeenCalled();
    });

    // ── moveTerminalToGroup ──────────────────────────────

    it("moveTerminalToGroup moves terminal to another group", () => {
        const gs = new GroupStore();
        const t = fakeTerminal("bash");
        gs.assignDefaultGroup(t);
        const target = gs.createGroup("Backend");
        const listener = vi.fn();
        gs.onDidChange(listener);

        gs.moveTerminalToGroup(t, target.id);

        expect(listener).toHaveBeenCalledWith({
            type: "terminalAssigned",
            terminal: t,
            groupId: target.id,
        });
        expect(gs.getGroup(UNGROUPED_ID)!.terminals).not.toContain(t);
        expect(gs.getGroup(target.id)!.terminals).toContain(t);
    });

    it("moveTerminalToGroup within same group reorders", () => {
        const gs = new GroupStore();
        const a = fakeTerminal("a");
        const b = fakeTerminal("b");
        gs.assignDefaultGroup(a);
        gs.assignDefaultGroup(b);
        // a → b currently
        gs.moveTerminalToGroup(b, UNGROUPED_ID, 0); // move b to position 0
        expect(gs.getGroup(UNGROUPED_ID)!.terminals).toEqual([b, a]);
    });

    it("moveTerminalToGroup with position -1 prepends", () => {
        const gs = new GroupStore();
        const a = fakeTerminal("a");
        const b = fakeTerminal("b");
        gs.assignDefaultGroup(a);
        gs.assignDefaultGroup(b);
        // a → b currently
        gs.moveTerminalToGroup(b, UNGROUPED_ID, -1);
        expect(gs.getGroup(UNGROUPED_ID)!.terminals).toEqual([b, a]);
    });

    it("moveTerminalToGroup with undefined position appends", () => {
        const gs = new GroupStore();
        const a = fakeTerminal("a");
        const b = fakeTerminal("b");
        gs.assignDefaultGroup(a);
        gs.assignDefaultGroup(b);
        // a → b currently
        gs.moveTerminalToGroup(a, UNGROUPED_ID, undefined);
        expect(gs.getGroup(UNGROUPED_ID)!.terminals).toEqual([b, a]);
    });

    // ── moveGroup ────────────────────────────────────────

    it("moveGroup keeps UNGROUPED first", () => {
        const gs = new GroupStore();
        const a = gs.createGroup("A");
        const b = gs.createGroup("B");
        // 未分組 → A → B

        gs.moveGroup(a.id, 0); // try to move A to position 0
        const groups = gs.getGroups();
        expect(groups[0].id).toBe(UNGROUPED_ID); // stays first
    });

    it("moveGroup reorders groups", () => {
        const gs = new GroupStore();
        const a = gs.createGroup("A");
        const b = gs.createGroup("B");
        // 未分組 → A → B

        gs.moveGroup(b.id, 1); // move B to position 1 (after default)
        const groups = gs.getGroups();
        expect(groups[0].id).toBe(UNGROUPED_ID);
        expect(groups[1].id).toBe(b.id);
        expect(groups[2].id).toBe(a.id);
    });

    it("moveGroup emits groupOrderChanged", () => {
        const gs = new GroupStore();
        const a = gs.createGroup("A");
        const listener = vi.fn();
        gs.onDidChange(listener);

        gs.moveGroup(a.id, 1);
        expect(listener).toHaveBeenCalledWith({
            type: "groupOrderChanged",
        });
    });

    // ── deleteGroup ──────────────────────────────────────

    it("deleteGroup reassigns terminals back to UNGROUPED", () => {
        const gs = new GroupStore();
        const t = fakeTerminal("bash");
        const target = gs.createGroup("Temp");
        gs.assignDefaultGroup(t);
        gs.moveTerminalToGroup(t, target.id);

        const listener = vi.fn();
        gs.onDidChange(listener);
        gs.deleteGroup(target.id);

        expect(listener).toHaveBeenCalledWith({
            type: "groupRemoved",
            groupId: target.id,
        });
        expect(gs.getGroup(target.id)).toBeUndefined();
        expect(gs.getGroup(UNGROUPED_ID)!.terminals).toContain(t);
    });

    it("deleteGroup(UNGROUPED_ID) is a no-op", () => {
        const gs = new GroupStore();
        const listener = vi.fn();
        gs.onDidChange(listener);

        gs.deleteGroup(UNGROUPED_ID);

        expect(listener).not.toHaveBeenCalled();
        expect(gs.getGroups()).toHaveLength(1);
    });

    // ── renameGroup / setGroupColor / toggleGroupCollapsed ─

    it("renameGroup emits groupChanged", () => {
        const gs = new GroupStore();
        const g = gs.createGroup("A");
        const listener = vi.fn();
        gs.onDidChange(listener);

        gs.renameGroup(g.id, "Renamed");

        expect(listener).toHaveBeenCalledWith({
            type: "groupChanged",
            groupId: g.id,
        });
        expect(gs.getGroup(g.id)!.name).toBe("Renamed");
    });

    it("renameGroup is no-op when name unchanged", () => {
        const gs = new GroupStore();
        const g = gs.createGroup("A");
        const listener = vi.fn();
        gs.onDidChange(listener);

        gs.renameGroup(g.id, "A");

        expect(listener).not.toHaveBeenCalled();
    });

    it("setGroupColor emits groupChanged", () => {
        const gs = new GroupStore();
        const g = gs.createGroup("A");
        const listener = vi.fn();
        gs.onDidChange(listener);

        gs.setGroupColor(g.id, "red");

        expect(listener).toHaveBeenCalledWith({
            type: "groupChanged",
            groupId: g.id,
        });
        expect(gs.getGroup(g.id)!.color).toBe("red");
    });

    it("toggleGroupCollapsed flips the flag and emits", () => {
        const gs = new GroupStore();
        const g = gs.createGroup("A");
        const listener = vi.fn();
        gs.onDidChange(listener);

        gs.toggleGroupCollapsed(g.id);
        expect(gs.getGroup(g.id)!.collapsed).toBe(true);
        expect(listener).toHaveBeenCalledWith({
            type: "groupChanged",
            groupId: g.id,
        });

        gs.toggleGroupCollapsed(g.id);
        expect(gs.getGroup(g.id)!.collapsed).toBe(false);
    });

    // ── aggregateUnseen ──────────────────────────────────

    it("aggregateUnseen counts correctly", () => {
        const gs = new GroupStore();
        const a = fakeTerminal("a");
        const b = fakeTerminal("b");
        const c = fakeTerminal("c");
        const unseen = new Set([a, c]);

        const count = gs.aggregateUnseen([a, b, c], (t) =>
            unseen.has(t)
        );
        expect(count).toBe(2);
    });

    it("aggregateUnseen returns 0 for empty list", () => {
        const gs = new GroupStore();
        const count = gs.aggregateUnseen([], () => true);
        expect(count).toBe(0);
    });

    // ── getGroupOf ───────────────────────────────────────

    it("getGroupOf returns the correct group", () => {
        const gs = new GroupStore();
        const t = fakeTerminal("bash");
        gs.assignDefaultGroup(t);
        const g = gs.createGroup("Backend");
        gs.moveTerminalToGroup(t, g.id);

        expect(gs.getGroupOf(t).id).toBe(g.id);
    });

    it("getGroupOf returns default group for unknown terminal", () => {
        const gs = new GroupStore();
        const t = fakeTerminal("ghost");

        expect(gs.getGroupOf(t).id).toBe(UNGROUPED_ID);
    });

    // ── onDidChange unsubscribe ──────────────────────────

    it("onDidChange unsubscribe stops further events", () => {
        const gs = new GroupStore();
        const listener = vi.fn();
        const off = gs.onDidChange(listener);
        off();

        gs.createGroup("A");

        expect(listener).not.toHaveBeenCalled();
    });
});