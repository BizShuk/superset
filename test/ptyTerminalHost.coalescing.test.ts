import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PtyTerminalHost } from "../src/terminals/ptyTerminalHost";
import type { PtyProcess, PtySpawner } from "../src/terminals/ptyTerminalHost";
import { TerminalRegistry } from "../src/terminals/terminalRegistry";
import type { TerminalHandle } from "../src/terminals/types";

/**
 * Coalescing tests for `PtyTerminalHost`.
 *
 * Contract being locked down:
 *   - Multiple `proc.onData` chunks delivered in the same event-loop
 *     turn collapse into a single `onWrite` callback carrying the joined
 *     string.
 *   - The flush boundary is the next `setImmediate` tick; advancing the
 *     timer via `vi.runAllTimers()` triggers the flush.
 *   - `detectActivity` runs per-chunk (not coalesced) so `markUnseen`
 *     timing is preserved.
 *   - `close()` flushes any pending buffer before tearing the proc down.
 *   - A throwing write listener does not abort the coalescing pipeline.
 *
 * `PtyTerminalHost` has no `vscode` import, so these tests use the
 * same fake `PtyProcess` pattern as `test/ptyTerminalHost.test.ts`.
 */
function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

function fakeProc() {
    let dataCb: ((data: string) => void) | undefined;
    let exitCb: ((code: number) => void) | undefined;
    const proc: PtyProcess = {
        onData(cb) {
            dataCb = cb;
        },
        onExit(cb) {
            exitCb = cb;
        },
        write() {
            // no-op
        },
        kill() {
            // no-op
        },
    };
    return {
        proc,
        fireData(d: string) {
            dataCb?.(d);
        },
        fireExit(code: number) {
            exitCb?.(code);
        },
    };
}

interface SetupResult {
    host_instance: PtyTerminalHost;
    fake: ReturnType<typeof fakeProc>;
    registry: TerminalRegistry;
    host: TerminalHandle;
}

function setup(): SetupResult {
    const registry = new TerminalRegistry();
    const host = fakeTerminal("coalesce-host");
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
    return { host_instance, fake, registry, host };
}

describe("PtyTerminalHost chunk coalescing", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("does not deliver to listeners until the setImmediate flush boundary", () => {
        const { host_instance, fake } = setup();
        const writeSpy = vi.fn();
        host_instance.onWrite(writeSpy);
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("a");
        fake.fireData("b");
        fake.fireData("c");

        // No tick yet — listener not invoked.
        expect(writeSpy).not.toHaveBeenCalled();

        vi.runAllTimers();

        // Three chunks joined into one emit.
        expect(writeSpy).toHaveBeenCalledTimes(1);
        expect(writeSpy).toHaveBeenCalledWith("abc");
    });

    it("each setImmediate boundary flushes once and re-arms independently", () => {
        const { host_instance, fake } = setup();
        const writeSpy = vi.fn();
        host_instance.onWrite(writeSpy);
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("x");
        fake.fireData("y");
        vi.runAllTimers();
        expect(writeSpy).toHaveBeenCalledTimes(1);
        expect(writeSpy).toHaveBeenLastCalledWith("xy");

        fake.fireData("z");
        vi.runAllTimers();
        expect(writeSpy).toHaveBeenCalledTimes(2);
        expect(writeSpy).toHaveBeenLastCalledWith("z");
    });

    it("high-frequency bursts collapse to a single emit with all data joined", () => {
        const { host_instance, fake } = setup();
        const chunks: string[] = [];
        host_instance.onWrite((d) => chunks.push(d));
        host_instance.open({ columns: 80, rows: 24 });

        const burst = 100;
        for (let i = 0; i < burst; i += 1) {
            fake.fireData(`chunk-${i}-`);
        }
        vi.runAllTimers();

        expect(chunks).toHaveLength(1);
        const joined = chunks[0];
        expect(joined).toBeDefined();
        for (let i = 0; i < burst; i += 1) {
            expect(joined).toContain(`chunk-${i}-`);
        }
    });

    it("close() flushes the pending buffer before tearing the proc down", () => {
        const { host_instance, fake } = setup();
        const writeSpy = vi.fn();
        host_instance.onWrite(writeSpy);
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("tail-before-close");
        expect(writeSpy).not.toHaveBeenCalled();

        host_instance.close();
        expect(writeSpy).toHaveBeenCalledTimes(1);
        expect(writeSpy).toHaveBeenCalledWith("tail-before-close");
    });

    it("close() with empty buffer does not invoke the listener", () => {
        const { host_instance } = setup();
        const writeSpy = vi.fn();
        host_instance.onWrite(writeSpy);
        host_instance.open({ columns: 80, rows: 24 });

        host_instance.close();

        expect(writeSpy).not.toHaveBeenCalled();
    });

    it("throwing write listener does not abort the coalescing pipeline", () => {
        const { host_instance, fake } = setup();
        const writeSpy = vi.fn();
        host_instance.onWrite(() => {
            throw new Error("kaboom");
        });
        host_instance.onWrite(writeSpy); // second listener must still fire
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("hello");
        vi.runAllTimers();

        // The throwing listener does not stop the second listener from
        // receiving the joined chunk.
        expect(writeSpy).toHaveBeenCalledTimes(1);
        expect(writeSpy).toHaveBeenCalledWith("hello");
    });

    it("detectActivity still runs per-chunk (not coalesced)", () => {
        const { host_instance, fake, registry, host } = setup();
        const active = fakeTerminal("active");
        registry.add(active);
        host_instance.open({ columns: 80, rows: 24 });

        // Active is the unrelated terminal → host is background.
        // (We can't easily override getActiveTerminal post-construction
        // without rebuilding, so we rely on the existing construction
        // returning undefined → host counts as non-active.)
        const unseenEvents: TerminalHandle[] = [];
        registry.onDidChange((e) => {
            if (e.type === "unseenChanged") unseenEvents.push(e.terminal);
        });

        for (let i = 0; i < 5; i += 1) {
            fake.fireData(`tick-${i}`);
        }
        // markUnseen is idempotent on the registry so even per-chunk
        // calls collapse to one unseenChanged event.
        expect(unseenEvents.filter((t) => t === host)).toHaveLength(1);

        // But the buffer still holds the joined text:
        vi.runAllTimers();
    });

    it("identical-tick chunks preserve order in the joined emit", () => {
        const { host_instance, fake } = setup();
        const writes: string[] = [];
        host_instance.onWrite((d) => writes.push(d));
        host_instance.open({ columns: 80, rows: 24 });

        const seq = ["alpha", "beta", "gamma", "delta"];
        for (const s of seq) {
            fake.fireData(s);
        }
        vi.runAllTimers();

        expect(writes).toEqual([seq.join("")]);
    });
});
