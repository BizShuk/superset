import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    createProcessActivitySource,
    pollOnce,
} from "../src/terminals/processActivitySource";
import type { ActivityEvent } from "../src/terminals/activitySource";
import type { TerminalHandle } from "../src/terminals/types";
import type { ShellSample } from "../src/terminals/processTreeSampler";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

/** `ps`-shaped payload from compact `[pid, ppid, cpuTime]` tuples. */
function psText(rows: Array<[number, number, string]>): string {
    return rows.map(([pid, ppid, time]) => `${pid} ${ppid} ${time} p${pid}`).join("\n");
}

function ctxFor(opts: {
    terminals: TerminalHandle[];
    pids: Map<TerminalHandle, number | undefined>;
    frames: string[];
}) {
    const events: ActivityEvent[] = [];
    let frame = 0;
    const runPs = vi.fn(async () => {
        const text = opts.frames[Math.min(frame, opts.frames.length - 1)];
        frame++;
        return text;
    });
    const resolvePid = vi.fn(async (t: TerminalHandle) => opts.pids.get(t));
    const ctx = {
        deps: {
            runPs,
            getTerminals: () => opts.terminals,
            resolvePid,
        },
        emit: (e: ActivityEvent) => events.push(e),
        previous: new WeakMap<TerminalHandle, ShellSample>(),
        pids: new WeakMap<TerminalHandle, number>(),
    };
    return { ctx, events, runPs, resolvePid };
}

describe("pollOnce", () => {
    it("skips the ps invocation entirely when no terminal is tracked", async () => {
        // Idle cost must be exactly zero for a window with no terminals.
        const { ctx, runPs, resolvePid } = ctxFor({
            terminals: [],
            pids: new Map(),
            frames: [""],
        });
        await pollOnce(ctx);
        expect(runPs).not.toHaveBeenCalled();
        expect(resolvePid).not.toHaveBeenCalled();
    });

    it("skips ps when no tracked terminal has a resolvable pid", async () => {
        // Pseudoterminal-backed terminals resolve to undefined; if that is all
        // we have, there is nothing to sample.
        const a = fakeTerminal("pty");
        const { ctx, runPs } = ctxFor({
            terminals: [a],
            pids: new Map([[a, undefined]]),
            frames: [""],
        });
        await pollOnce(ctx);
        expect(runPs).not.toHaveBeenCalled();
    });

    it("emits nothing on the baseline poll", async () => {
        const a = fakeTerminal("a");
        const { ctx, events } = ctxFor({
            terminals: [a],
            pids: new Map([[a, 500]]),
            frames: [psText([[500, 1, "0:01.00"], [600, 500, "0:05.00"]])],
        });
        await pollOnce(ctx);
        expect(events).toEqual([]);
    });

    it("emits when CPU advances between two polls", async () => {
        const a = fakeTerminal("a");
        const { ctx, events } = ctxFor({
            terminals: [a],
            pids: new Map([[a, 500]]),
            frames: [
                psText([[500, 1, "0:01.00"], [600, 500, "0:05.00"]]),
                psText([[500, 1, "0:01.00"], [600, 500, "0:06.00"]]),
            ],
        });
        await pollOnce(ctx);
        await pollOnce(ctx);
        expect(events).toHaveLength(1);
        expect(events[0].terminal).toBe(a);
        expect(events[0].reason).toContain("proc:");
    });

    it("emits when a foreground process starts", async () => {
        const a = fakeTerminal("a");
        const { ctx, events } = ctxFor({
            terminals: [a],
            pids: new Map([[a, 500]]),
            frames: [
                psText([[500, 1, "0:01.00"], [600, 500, "0:05.00"]]),
                psText([
                    [500, 1, "0:01.00"],
                    [600, 500, "0:05.00"],
                    [700, 600, "0:00.00"],
                ]),
            ],
        });
        await pollOnce(ctx);
        await pollOnce(ctx);
        expect(events).toHaveLength(1);
        expect(events[0].reason).toContain("process set changed");
    });

    it("stays quiet while a shell sits at its prompt", async () => {
        const a = fakeTerminal("a");
        // Shell's own CPU climbs every poll (prompt repaint) but it has no
        // children — this must never register as activity.
        const { ctx, events } = ctxFor({
            terminals: [a],
            pids: new Map([[a, 500]]),
            frames: [
                psText([[500, 1, "0:01.00"]]),
                psText([[500, 1, "0:09.00"]]),
                psText([[500, 1, "0:20.00"]]),
            ],
        });
        await pollOnce(ctx);
        await pollOnce(ctx);
        await pollOnce(ctx);
        expect(events).toEqual([]);
    });

    it("runs ps once per poll regardless of terminal count", async () => {
        // The single-snapshot-for-all-terminals property is the reason this
        // source scales; a regression to per-terminal ps would be invisible
        // in behaviour but linear in cost.
        const a = fakeTerminal("a");
        const b = fakeTerminal("b");
        const c = fakeTerminal("c");
        const { ctx, runPs } = ctxFor({
            terminals: [a, b, c],
            pids: new Map([
                [a, 500],
                [b, 501],
                [c, 502],
            ]),
            frames: [psText([[500, 1, "0:01.00"]])],
        });
        await pollOnce(ctx);
        expect(runPs).toHaveBeenCalledTimes(1);
    });

    it("tracks each terminal's history independently", async () => {
        const a = fakeTerminal("a");
        const b = fakeTerminal("b");
        const { ctx, events } = ctxFor({
            terminals: [a, b],
            pids: new Map([
                [a, 500],
                [b, 501],
            ]),
            frames: [
                psText([
                    [500, 1, "0:01.00"],
                    [600, 500, "0:05.00"],
                    [501, 1, "0:01.00"],
                    [601, 501, "0:05.00"],
                ]),
                // Only b's child burns CPU.
                psText([
                    [500, 1, "0:01.00"],
                    [600, 500, "0:05.00"],
                    [501, 1, "0:01.00"],
                    [601, 501, "0:09.00"],
                ]),
            ],
        });
        await pollOnce(ctx);
        await pollOnce(ctx);
        expect(events).toHaveLength(1);
        expect(events[0].terminal).toBe(b);
    });

    it("caches the resolved pid across polls", async () => {
        const a = fakeTerminal("a");
        const { ctx, resolvePid } = ctxFor({
            terminals: [a],
            pids: new Map([[a, 500]]),
            frames: [psText([[500, 1, "0:01.00"]])],
        });
        await pollOnce(ctx);
        await pollOnce(ctx);
        await pollOnce(ctx);
        expect(resolvePid).toHaveBeenCalledTimes(1);
    });
});

describe("createProcessActivitySource", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("does not poll before the first interval elapses", async () => {
        const runPs = vi.fn(async () => "");
        const source = createProcessActivitySource({
            runPs,
            getTerminals: () => [fakeTerminal("a")],
            resolvePid: async () => 500,
            intervalMs: 1000,
        });
        const off = source(() => {});
        expect(runPs).not.toHaveBeenCalled();
        off();
    });

    it("polls on the interval", async () => {
        const runPs = vi.fn(async () => "500 1 0:01.00 zsh");
        const source = createProcessActivitySource({
            runPs,
            getTerminals: () => [fakeTerminal("a")],
            resolvePid: async () => 500,
            intervalMs: 1000,
        });
        const off = source(() => {});
        await vi.advanceTimersByTimeAsync(1000);
        expect(runPs).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(runPs).toHaveBeenCalledTimes(2);
        off();
    });

    it("stops polling after unsubscribe", async () => {
        const runPs = vi.fn(async () => "500 1 0:01.00 zsh");
        const source = createProcessActivitySource({
            runPs,
            getTerminals: () => [fakeTerminal("a")],
            resolvePid: async () => 500,
            intervalMs: 1000,
        });
        const off = source(() => {});
        await vi.advanceTimersByTimeAsync(1000);
        expect(runPs).toHaveBeenCalledTimes(1);
        off();
        await vi.advanceTimersByTimeAsync(5000);
        expect(runPs).toHaveBeenCalledTimes(1);
    });

    it("keeps polling after a ps failure", async () => {
        // `ps` can fail transiently under fork pressure; one bad tick must
        // not silently kill detection for the rest of the session.
        const log = vi.fn();
        let calls = 0;
        const runPs = vi.fn(async () => {
            calls++;
            if (calls === 1) {
                throw new Error("EAGAIN");
            }
            return "500 1 0:01.00 zsh";
        });
        const source = createProcessActivitySource({
            runPs,
            getTerminals: () => [fakeTerminal("a")],
            resolvePid: async () => 500,
            intervalMs: 1000,
            log,
        });
        const off = source(() => {});
        await vi.advanceTimersByTimeAsync(1000);
        expect(log).toHaveBeenCalledWith(expect.stringContaining("poll error"));
        await vi.advanceTimersByTimeAsync(1000);
        expect(runPs).toHaveBeenCalledTimes(2);
        off();
    });

    it("does not overlap ticks when ps runs longer than the interval", async () => {
        // Serialised ticks are what keep a slow `ps` from stacking timers.
        let resolvePs: (() => void) | undefined;
        const runPs = vi.fn(
            () =>
                new Promise<string>((resolve) => {
                    resolvePs = () => resolve("500 1 0:01.00 zsh");
                })
        );
        const source = createProcessActivitySource({
            runPs,
            getTerminals: () => [fakeTerminal("a")],
            resolvePid: async () => 500,
            intervalMs: 1000,
        });
        const off = source(() => {});
        await vi.advanceTimersByTimeAsync(1000);
        expect(runPs).toHaveBeenCalledTimes(1);
        // Interval elapses several more times while the first ps is in flight.
        await vi.advanceTimersByTimeAsync(5000);
        expect(runPs).toHaveBeenCalledTimes(1);
        resolvePs?.();
        await vi.advanceTimersByTimeAsync(1000);
        expect(runPs).toHaveBeenCalledTimes(2);
        off();
    });
});
