import { describe, it, expect, vi } from "vitest";
import { TerminalRegistry } from "../src/terminals/terminalRegistry";
import type { TerminalHandle } from "../src/terminals/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

describe("TerminalRegistry", () => {
    it("starts empty", () => {
        const r = new TerminalRegistry();
        expect(r.getAll()).toEqual([]);
        expect(r.getUnseen()).toEqual([]);
    });    it("emits added on add()", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        const listener = vi.fn();
        r.onDidChange(listener);

        r.add(t);

        expect(listener).toHaveBeenCalledWith({ type: "added", terminal: t });
        expect(r.getAll()).toHaveLength(1);
        expect(r.has(t)).toBe(true);
    });

    it("does not emit added on duplicate add", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        const listener = vi.fn();
        r.onDidChange(listener);

        r.add(t);
        r.add(t);

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("emits removed on remove()", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        const listener = vi.fn();
        r.onDidChange(listener);

        r.remove(t);

        expect(listener).toHaveBeenCalledWith({ type: "removed", terminal: t });
        expect(r.has(t)).toBe(false);
    });

    it("emits unseenChanged on markUnseen()", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        const listener = vi.fn();
        r.onDidChange(listener);

        r.markUnseen(t);

        expect(listener).toHaveBeenCalledWith({
            type: "unseenChanged",
            terminal: t,
            hasUnseenOutput: true,
        });
        expect(r.getUnseen()).toHaveLength(1);
    });

    it("markUnseen is idempotent (no re-emit)", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        r.markUnseen(t);

        const listener = vi.fn();
        r.onDidChange(listener);

        r.markUnseen(t);

        expect(listener).not.toHaveBeenCalled();
    });

    it("emits unseenChanged false on clearUnseen()", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        r.markUnseen(t);
        const listener = vi.fn();
        r.onDidChange(listener);

        r.clearUnseen(t);

        expect(listener).toHaveBeenCalledWith({
            type: "unseenChanged",
            terminal: t,
            hasUnseenOutput: false,
        });
        expect(r.getUnseen()).toHaveLength(0);
    });

    it("clearUnseen is no-op when not unseen", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        const listener = vi.fn();
        r.onDidChange(listener);

        r.clearUnseen(t);

        expect(listener).not.toHaveBeenCalled();
    });

    it("getUnseen returns only entries with unseen flag", () => {
        const r = new TerminalRegistry();
        const a = fakeTerminal("a");
        const b = fakeTerminal("b");
        r.add(a);
        r.add(b);
        r.markUnseen(a);

        const unseen = r.getUnseen();
        expect(unseen).toHaveLength(1);
        expect(unseen[0].terminal).toBe(a);
    });

    it("unsubscribe stops further events", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        const listener = vi.fn();
        const off = r.onDidChange(listener);
        off();

        r.add(t);

        expect(listener).not.toHaveBeenCalled();
    });

    it("isUnseen returns false for unknown terminal", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        expect(r.isUnseen(t)).toBe(false);
    });

    it("isUnseen returns false for added but not marked unseen", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        expect(r.isUnseen(t)).toBe(false);
    });

    it("isUnseen returns true after markUnseen", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        r.markUnseen(t);
        expect(r.isUnseen(t)).toBe(true);
    });

    it("isUnseen returns false again after clearUnseen", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        r.markUnseen(t);
        r.clearUnseen(t);
        expect(r.isUnseen(t)).toBe(false);
    });

    it("assigns a stable string id on add()", () => {
        const r = new TerminalRegistry();
        const t = { name: "bash", show: () => {}, dispose: () => {} } as any;
        r.add(t);
        const all = r.getAll();
        expect(typeof all[0].id).toBe("string");
        expect(all[0].id.length).toBeGreaterThan(0);
    });

    it("keeps the same id across markUnseen", () => {
        const r = new TerminalRegistry();
        const t = { name: "bash", show: () => {}, dispose: () => {} } as any;
        r.add(t);
        const idBefore = r.getAll()[0].id;
        r.markUnseen(t);
        const idAfter = r.getAll()[0].id;
        expect(idAfter).toBe(idBefore);
    });

    it("different terminals get different ids", () => {
        const r = new TerminalRegistry();
        const a = { name: "a", show: () => {}, dispose: () => {} } as any;
        const b = { name: "b", show: () => {}, dispose: () => {} } as any;
        r.add(a);
        r.add(b);
        const ids = r.getAll().map((e) => e.id);
        expect(ids[0]).not.toBe(ids[1]);
    });
});
