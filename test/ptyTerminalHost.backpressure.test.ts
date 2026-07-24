import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PtyTerminalHost } from "../src/terminals/ptyTerminalHost";
import type { PtyProcess, PtySpawner } from "../src/terminals/ptyTerminalHost";
import { TerminalRegistry } from "../src/terminals/terminalRegistry";
import type { TerminalHandle } from "../src/terminals/types";

/**
 * Backpressure tests for `PtyTerminalHost`.
 *
 * Contract being locked down:
 *   - When cumulative pending bytes (delivered by the PTY) cross
 *     HIGH_WATER_MARK (4 MiB) the host calls `proc.pause()` exactly once.
 *   - Additional chunks delivered while paused do NOT cause `pause` to be
 *     called again (idempotent).
 *   - A `setImmediate` drain tick where pending bytes have dropped to or
 *     below LOW_WATER_MARK (1 MiB) causes the host to call `proc.resume()`.
 *   - If pending bytes are still above LOW on the drain tick, `resume` is
 *     NOT called.
 *   - `close()` while paused calls `proc.resume()` and resets internal state.
 *   - A throwing write listener does not affect pause/resume bookkeeping.
 *
 * NOTE: As of writing, the production `PtyProcess` interface does NOT
 * declare `pause`/`resume` and the host does not yet track pending bytes.
 * The fake proc below adds `pause`/`resume` via `as unknown as PtyProcess`,
 * and the test simulates a drain by writing the `pendingBytes` field
 * directly with `(host as ...).pendingBytes = N`. Both casts are
 * intentional contract assertions — the tests are written ahead of the
 * implementation and will fail at runtime (or TypeScript) until the
 * implementation lands.
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

/**
 * Write the host's pending-bytes counter. The most realistic impl
 * model is "pending bytes = received - consumed"; the test sets the
 * value directly to simulate the consumer draining the buffer.
 */
function setPendingBytes(host: PtyTerminalHost, bytes: number): void {
    (host as unknown as { pendingBytes: number }).pendingBytes = bytes;
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

        fake.fireData("a".repeat(5 * 1024 * 1024));
        vi.runAllTimers();
        expect(fake.pauseCalls).toHaveLength(1);

        // More chunks while paused. The host must NOT call pause again.
        fake.fireData("b".repeat(5 * 1024 * 1024));
        fake.fireData("c".repeat(5 * 1024 * 1024));
        vi.runAllTimers();

        expect(fake.pauseCalls).toHaveLength(1);
    });

    it("setImmediate drain tick with pending bytes <= LOW calls resume", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("a".repeat(5 * 1024 * 1024));
        vi.runAllTimers();
        expect(fake.pauseCalls).toHaveLength(1);
        expect(fake.resumeCalls).toHaveLength(0);

        // Simulate the consumer draining back below LOW (1 MiB).
        setPendingBytes(host_instance, 500 * 1024);
        vi.runAllTimers();

        expect(fake.resumeCalls).toHaveLength(1);
    });

    it("setImmediate drain tick with pending bytes still > LOW does NOT call resume", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("a".repeat(5 * 1024 * 1024));
        vi.runAllTimers();
        expect(fake.pauseCalls).toHaveLength(1);

        // Partial drain: 2 MiB still > LOW (1 MiB).
        setPendingBytes(host_instance, 2 * 1024 * 1024);
        vi.runAllTimers();

        expect(fake.resumeCalls).toHaveLength(0);
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
