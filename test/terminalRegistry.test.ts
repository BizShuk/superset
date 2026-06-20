import { describe, it, expect, vi } from "vitest";
import { TerminalRegistry } from "../src/terminalRegistry";
import type { TerminalHandle } from "../src/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

describe("TerminalRegistry", () => {
    it("starts empty", () => {
        const r = new TerminalRegistry();
        expect(r.getAll()).toEqual([]);
        expect(r.getUnseen()).toEqual([]);
    });

    it("emits added on add()", () => {
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
        expect(unseen[0]).toBe(a);
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
});
