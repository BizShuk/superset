import { describe, it, expect, vi, beforeEach } from "vitest";
import { PtyTap, type Frame, type FrameSink } from "../src/terminals/ptyTap";

/**
 * Pure router tests for `PtyTap`. No `vscode` imports; the sink is
 * hand-rolled so we can assert frame shape directly. Time is controlled
 * via `now` for deterministic assertions.
 */

class RecordingSink implements FrameSink {
    frames: Frame[] = [];
    write(frame: Frame): void {
        this.frames.push(frame);
    }
}

function newTap(now = () => 1000): { tap: PtyTap; sink: RecordingSink } {
    const sink = new RecordingSink();
    const tap = new PtyTap({
        sessionId: "sess-1",
        pid: 4242,
        sink,
        now,
    });
    return { tap, sink };
}

describe("PtyTap — meta frame emission", () => {
    it("emits a meta frame before the first event frame", () => {
        const { tap, sink } = newTap(() => 100);
        tap.bindPty("zsh", "/cwd");
        expect(sink.frames[0]).toEqual({
            t: "meta",
            v: 1,
            sessionId: "sess-1",
            pid: 4242,
            ts: 100,
        });
    });

    it("emits exactly one meta frame even after many bindings", () => {
        const { tap, sink } = newTap();
        tap.bindPty("a", "/");
        tap.bindShellExec("b");
        tap.bindPty("c", "/x");
        const metas = sink.frames.filter((f) => f.t === "meta");
        expect(metas.length).toBe(1);
    });
});

describe("PtyTap — bindPty", () => {
    it("emits open + data + close in order", () => {
        const { tap, sink } = newTap(() => 200);
        const b = tap.bindPty("zsh", "/home");
        b.onData("hello\n");
        b.onClose(0);
        expect(sink.frames.slice(1)).toEqual([
            { t: "open", id: 1, name: "zsh", cwd: "/home", kind: "pty", ts: 200 },
            { t: "data", id: 1, chunk: "hello\n", ts: 200 },
            { t: "close", id: 1, code: 0, ts: 200 },
        ]);
    });

    it("returns monotonically increasing ids per binding", () => {
        const { tap } = newTap();
        const b1 = tap.bindPty("a");
        const b2 = tap.bindPty("b");
        const b3 = tap.bindShellExec("c");
        expect(b1.id).toBeLessThan(b2.id);
        expect(b2.id).toBeLessThan(b3.id);
    });

    it("is idempotent on close", () => {
        const { tap, sink } = newTap();
        const b = tap.bindPty("a");
        b.onClose(0);
        b.onClose(1);
        b.onClose(null);
        const closes = sink.frames.filter((f) => f.t === "close");
        expect(closes.length).toBe(1);
    });

    it("drops data after close", () => {
        const { tap, sink } = newTap();
        const b = tap.bindPty("a");
        b.onClose(0);
        b.onData("post-close");
        const datas = sink.frames.filter((f) => f.t === "data");
        expect(datas.length).toBe(0);
    });
});

describe("PtyTap — bindShellExec", () => {
    it("emits kind: 'shell-exec' on open", () => {
        const { tap, sink } = newTap();
        tap.bindShellExec("bash");
        const open = sink.frames.find((f) => f.t === "open");
        expect(open).toMatchObject({ kind: "shell-exec", name: "bash" });
    });

    it("forwards data and close", () => {
        const { tap, sink } = newTap();
        const b = tap.bindShellExec("bash");
        b.onData("$ ");
        b.onData("ls\n");
        b.onClose(null);
        const datas = sink.frames.filter((f) => f.t === "data");
        expect(datas).toHaveLength(2);
        expect(datas[0]).toMatchObject({ chunk: "$ " });
        expect(datas[1]).toMatchObject({ chunk: "ls\n" });
    });
});

describe("PtyTap — entry tracking", () => {
    it("tracks open entries and removes them on close", () => {
        const { tap } = newTap();
        const a = tap.bindPty("a");
        const b = tap.bindShellExec("b");
        expect(tap.size()).toBe(2);
        a.onClose(0);
        expect(tap.size()).toBe(1);
        expect(tap.openEntries().get(a.id)).toBeUndefined();
        expect(tap.openEntries().get(b.id)).toBeDefined();
        b.onClose(null);
        expect(tap.size()).toBe(0);
    });
});

describe("PtyTap — sink error isolation", () => {
    it("does not propagate sink errors to the caller", () => {
        const tap = new PtyTap({
            sessionId: "s",
            pid: 1,
            sink: {
                write() {
                    throw new Error("sink boom");
                },
            },
        });
        expect(() => tap.bindPty("a")).not.toThrow();
    });

    it("logs sink errors via the optional log callback", () => {
        const log = vi.fn();
        const tap = new PtyTap({
            sessionId: "s",
            pid: 1,
            sink: {
                write() {
                    throw new Error("boom");
                },
            },
            log,
        });
        tap.bindPty("a");
        expect(log).toHaveBeenCalled();
        expect(log.mock.calls[0][0]).toMatch(/sink write ERROR/);
    });
});
