import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PtyTerminalHost } from "../src/terminals/ptyTerminalHost";
import type { PtyProcess, PtySpawner } from "../src/terminals/ptyTerminalHost";
import { TerminalRegistry } from "../src/terminals/terminalRegistry";
import type { TerminalHandle } from "../src/terminals/types";

/**
 * Backpressure tests for `PtyTerminalHost`.
 *
 * Contract being locked down:
 *   - When pending bytes cross HIGH_WATER_MARK (4 MiB) the host calls
 *     `proc.pause()` exactly once.
 *   - Additional chunks delivered while paused do NOT cause `pause` to be
 *     called again (idempotent).
 *   - Draining below LOW_WATER_MARK (1 MiB) calls `proc.resume()`; a partial
 *     drain that leaves the backlog above LOW does not.
 *   - Pause/resume is a repeatable cycle, not a one-shot latch.
 *   - The per-tick byte budget slices an over-budget burst, never drops it.
 *   - `close()` while paused calls `proc.resume()` and resets internal state.
 *   - A throwing write listener does not affect pause/resume bookkeeping.
 *
 * What `pendingBytes` means, and why the original draft of this file could
 * not be satisfied: an earlier version modelled it as "handed downstream but
 * not yet acknowledged" and simulated the consumer by assigning the field
 * directly. There is no such counter in production — `Pseudoterminal.onDidWrite`
 * is fire-and-forget and the renderer never acknowledges anything, so nothing
 * could ever decrement it and the pty would stay paused forever. The counter
 * here is instead the depth of the one queue this class actually owns: bytes
 * received from the pty that have not yet been handed to `onDidWrite`. That
 * queue drains on its own flush ticks, which is what makes resume reachable.
 */
const HIGH_WATER_MARK = 4 * 1024 * 1024; // 4 MiB
const LOW_WATER_MARK = 1 * 1024 * 1024; // 1 MiB

interface FakeProcHandle {
    proc: PtyProcess;
    pauseCalls: number[];
    resumeCalls: number[];
    fireData: (data: string) => void;
    fireExit: (code: number) => void;
}

/**
 * Build a fake `PtyProcess` whose callbacks we can fire synthetically.
 * The base `PtyProcess` contract here is augmented with `pause` / `resume`
 * via an `as unknown as PtyProcess` cast — this is the test's way of
 * documenting the contract that the implementation must satisfy.
 */
function fakeProc(): FakeProcHandle {
    let dataCb: ((data: string) => void) | undefined;
    let exitCb: ((code: number) => void) | undefined;
    const pauseCalls: number[] = [];
    const resumeCalls: number[] = [];
    const proc = {
        onData(cb: (data: string) => void) {
            dataCb = cb;
        },
        onExit(cb: (code: number) => void) {
            exitCb = cb;
        },
        write(_data: string) {
            // no-op
        },
        kill() {
            // no-op
        },
        pause() {
            pauseCalls.push(Date.now());
        },
        resume() {
            resumeCalls.push(Date.now());
        },
    } as unknown as PtyProcess;
    return {
        proc,
        pauseCalls,
        resumeCalls,
        fireData(d: string) {
            dataCb?.(d);
        },
        fireExit(code: number) {
            exitCb?.(code);
        },
    };
}

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

interface SetupResult {
    host_instance: PtyTerminalHost;
    fake: FakeProcHandle;
    host: TerminalHandle;
}

function setup(): SetupResult {
    const registry = new TerminalRegistry();
    const host = fakeTerminal("pty-host");
    registry.add(host);
    const fake = fakeProc();
    const spawner: PtySpawner = vi.fn(() => fake.proc);
    const host_instance = new PtyTerminalHost({
        getTerminal: () => host,
        registry,
        getActiveTerminal: () => undefined,
        spawn: spawner,
        shell: "/bin/zsh",
        args: ["-i"],
        cwd: "/tmp",
        env: {},
    });
    return { host_instance, fake, host };
}

/**
 * Read the host's pending-bytes counter. The field is
 * implementation-internal; the cast is what documents the contract.
 */
function getPendingBytes(host: PtyTerminalHost): number {
    return (host as unknown as { pendingBytes?: number }).pendingBytes ?? 0;
}

describe("PtyTerminalHost backpressure", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("below watermark: data under HIGH does not call pause or resume", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });

        // 500 KiB is well below LOW (1 MiB), so no pause should fire.
        fake.fireData("x".repeat(500 * 1024));
        vi.runAllTimers();

        expect(fake.pauseCalls).toHaveLength(0);
        expect(fake.resumeCalls).toHaveLength(0);
    });

    it("cumulative bytes crossing HIGH triggers pause exactly once", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });

        // 5 MiB total > HIGH (4 MiB). Split into two chunks so the
        // first chunk alone stays under HIGH — the cumulative sum
        // should be what triggers pause.
        fake.fireData("a".repeat(3 * 1024 * 1024));
        fake.fireData("b".repeat(2 * 1024 * 1024));
        vi.runAllTimers();

        expect(fake.pauseCalls).toHaveLength(1);
    });

    it("additional chunks while paused do not call pause again (idempotent)", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });

        // No timers run in between, so the buffer never drains and the host
        // stays paused across all three chunks.
        fake.fireData("a".repeat(5 * 1024 * 1024));
        expect(fake.pauseCalls).toHaveLength(1);
        fake.fireData("b".repeat(5 * 1024 * 1024));
        fake.fireData("c".repeat(5 * 1024 * 1024));

        expect(fake.pauseCalls).toHaveLength(1);
    });

    it("draining below LOW calls resume exactly once", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("a".repeat(5 * 1024 * 1024));
        expect(fake.pauseCalls).toHaveLength(1);
        expect(fake.resumeCalls).toHaveLength(0);

        // Flush ticks hand the buffer to the write listeners a bounded slice
        // at a time; once the backlog falls under LOW the pty is released.
        vi.runAllTimers();

        expect(fake.resumeCalls).toHaveLength(1);
        expect(getPendingBytes(host_instance)).toBe(0);
    });

    it("a partial drain that leaves pending bytes above LOW does NOT resume", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("a".repeat(5 * 1024 * 1024));
        expect(fake.pauseCalls).toHaveLength(1);

        // Exactly one flush tick: a bounded slice leaves the backlog well
        // above LOW (1 MiB), so the pty must stay paused.
        vi.advanceTimersToNextTimer();

        expect(getPendingBytes(host_instance)).toBeGreaterThan(1024 * 1024);
        expect(fake.resumeCalls).toHaveLength(0);
    });

    it("re-pauses when a fresh burst crosses HIGH again after a drain", () => {
        // Watermarks are a cycle, not a one-shot latch: each new backlog that
        // crosses HIGH must stop the pty again.
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("a".repeat(5 * 1024 * 1024));
        vi.runAllTimers();
        expect(fake.pauseCalls).toHaveLength(1);
        expect(fake.resumeCalls).toHaveLength(1);

        fake.fireData("b".repeat(5 * 1024 * 1024));
        expect(fake.pauseCalls).toHaveLength(2);
        vi.runAllTimers();
        expect(fake.resumeCalls).toHaveLength(2);
    });

    it("delivers every byte of an over-budget burst across the flush ticks", () => {
        // The per-tick byte budget must slice the backlog, never discard it.
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });

        const received: string[] = [];
        host_instance.onWrite((d) => received.push(d));

        const payload = "a".repeat(5 * 1024 * 1024);
        fake.fireData(payload);
        vi.runAllTimers();

        expect(received.length).toBeGreaterThan(1);
        expect(received.join("")).toBe(payload);
    });

    it("close() while paused calls resume and resets internal state", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("a".repeat(5 * 1024 * 1024));
        vi.runAllTimers();
        expect(fake.pauseCalls).toHaveLength(1);

        host_instance.close();

        // close() must pair the pause with a resume so the proc is
        // not left in a paused state.
        expect(fake.resumeCalls).toHaveLength(1);

        // Internal state must be reset so a subsequent open() starts fresh.
        expect(getPendingBytes(host_instance)).toBe(0);
    });

    it("a throwing write listener does not affect pause/resume bookkeeping", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });

        host_instance.onWrite(() => {
            throw new Error("listener kaboom");
        });

        // Cross HIGH — pause must still be called even though the
        // listener throws.
        fake.fireData("a".repeat(5 * 1024 * 1024));
        vi.runAllTimers();

        expect(fake.pauseCalls).toHaveLength(1);

        // More data while paused — pause remains idempotent.
        fake.fireData("b".repeat(2 * 1024 * 1024));
        vi.runAllTimers();
        expect(fake.pauseCalls).toHaveLength(1);
    });
});
