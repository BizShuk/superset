import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    PtyTerminalHost,
    normalizeWaterMarks,
    DEFAULT_HIGH_WATER_MARK,
    DEFAULT_LOW_WATER_MARK,
    MIN_WATER_MARK,
    MAX_WATER_MARK,
    KILL_ESCALATION_MS,
} from "../src/terminals/ptyTerminalHost";
import type { PtyProcess, PtySpawner } from "../src/terminals/ptyTerminalHost";
import { TerminalRegistry } from "../src/terminals/terminalRegistry";
import type { TerminalHandle } from "../src/terminals/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

function fakeProc() {
    let dataCb: ((d: string) => void) | undefined;
    let exitCb: ((c: number) => void) | undefined;
    const writes: string[] = [];
    const kills: Array<string | undefined> = [];
    const proc: PtyProcess = {
        onData: (cb) => {
            dataCb = cb;
        },
        onExit: (cb) => {
            exitCb = cb;
        },
        write: (d) => writes.push(d),
        kill: (signal) => kills.push(signal),
        resize: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
    };
    return {
        proc,
        writes,
        kills,
        fireData: (d: string) => dataCb?.(d),
        fireExit: (c: number) => exitCb?.(c),
    };
}

function setup(getConfig?: () => Partial<Record<string, number>>) {
    const registry = new TerminalRegistry();
    const terminal = fakeTerminal("pty");
    registry.add(terminal);
    const fake = fakeProc();
    const spawn: PtySpawner = vi.fn(() => fake.proc);
    const log = vi.fn();
    const host = new PtyTerminalHost({
        getTerminal: () => terminal,
        registry,
        getActiveTerminal: () => undefined,
        spawn,
        shell: "/bin/zsh",
        args: ["-i"],
        cwd: "/tmp",
        env: {},
        log,
        getConfig: getConfig as never,
    });
    return { host, fake, spawn, log, terminal };
}

describe("normalizeWaterMarks", () => {
    it("falls back to the defaults when nothing is configured", () => {
        expect(normalizeWaterMarks(undefined)).toEqual({
            highWaterMark: DEFAULT_HIGH_WATER_MARK,
            lowWaterMark: DEFAULT_LOW_WATER_MARK,
        });
    });

    it("clamps values into the supported range", () => {
        const tiny = normalizeWaterMarks({
            highWaterMark: 1,
            lowWaterMark: 1,
        });
        expect(tiny.highWaterMark).toBe(MIN_WATER_MARK);
        const huge = normalizeWaterMarks({
            highWaterMark: 999 * 1024 * 1024,
            lowWaterMark: MIN_WATER_MARK,
        });
        expect(huge.highWaterMark).toBe(MAX_WATER_MARK);
    });

    it("repairs a low mark that is not below the high mark", () => {
        // A low mark at or above high can never be reached from above, so the
        // pty would pause and never resume.
        const fixed = normalizeWaterMarks({
            highWaterMark: 8 * 1024 * 1024,
            lowWaterMark: 32 * 1024 * 1024,
        });
        expect(fixed.lowWaterMark).toBeLessThan(fixed.highWaterMark);
    });

    it("ignores non-finite input", () => {
        expect(
            normalizeWaterMarks({
                highWaterMark: Number.NaN,
                lowWaterMark: Number.POSITIVE_INFINITY,
            })
        ).toEqual({
            highWaterMark: DEFAULT_HIGH_WATER_MARK,
            lowWaterMark: DEFAULT_LOW_WATER_MARK,
        });
    });
});

describe("PtyTerminalHost lifecycle hardening", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("drops input after the process exits instead of writing to a dead pty", () => {
        // Previously `proc` stayed set after exit, so every keystroke was
        // written into a dead pty and the error swallowed — the terminal
        // looked alive but silently ignored everything typed.
        const { host, fake } = setup();
        host.open({ columns: 80, rows: 24 });
        host.handleInput("before\n");
        expect(fake.writes).toEqual(["before\n"]);

        fake.fireExit(0);
        host.handleInput("after\n");
        expect(fake.writes).toEqual(["before\n"]);
    });

    it("reports and closes when spawning the PTY fails instead of leaving a stuck terminal", () => {
        const registry = new TerminalRegistry();
        const terminal = fakeTerminal("pty");
        registry.add(terminal);
        const spawn = vi.fn(() => {
            throw new Error("posix_spawnp failed");
        });
        const log = vi.fn();
        const onSpawnError = vi.fn();
        const host = new PtyTerminalHost({
            getTerminal: () => terminal,
            registry,
            getActiveTerminal: () => undefined,
            spawn,
            shell: "/bin/zsh",
            args: ["-i"],
            cwd: "/tmp",
            env: {},
            log,
            onSpawnError,
        });
        const writes: string[] = [];
        const onClose = vi.fn();
        host.onWrite((data) => writes.push(data));
        host.onClose(onClose);

        expect(() => host.open({ columns: 80, rows: 24 })).not.toThrow();
        expect(writes.join("")).toContain("posix_spawnp failed");
        expect(onSpawnError).toHaveBeenCalledWith("posix_spawnp failed");
        expect(onClose).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledWith(1);
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("spawn ERROR: posix_spawnp failed")
        );

        host.open({ columns: 80, rows: 24 });
        expect(spawn).toHaveBeenCalledOnce();
    });

    it("fires onClose exactly once when exit is followed by close()", () => {
        const { host, fake } = setup();
        host.open({ columns: 80, rows: 24 });
        const onClose = vi.fn();
        host.onClose(onClose);

        fake.fireExit(3);
        host.close();

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledWith(3);
    });

    it("does not kill again after the process already exited", () => {
        const { host, fake } = setup();
        host.open({ columns: 80, rows: 24 });
        fake.fireExit(0);
        host.close();
        expect(fake.kills).toEqual([]);
    });

    it("flushes buffered output before reporting exit", () => {
        const { host, fake } = setup();
        host.open({ columns: 80, rows: 24 });
        const received: string[] = [];
        host.onWrite((d) => received.push(d));

        fake.fireData("tail");
        fake.fireExit(0);

        expect(received.join("")).toBe("tail");
    });

    it("escalates to SIGKILL when the polite kill does not reap the process", () => {
        // A foreground process can ignore SIGHUP (a wedged ssh, a docker
        // exec); without escalation those shells outlive the window and leak
        // their pty fds.
        const { host, fake } = setup();
        host.open({ columns: 80, rows: 24 });
        host.close();
        expect(fake.kills).toEqual([undefined]);

        vi.advanceTimersByTime(KILL_ESCALATION_MS);
        expect(fake.kills).toEqual([undefined, "SIGKILL"]);
    });

    it("cancels the SIGKILL escalation when the process exits in time", () => {
        const { host, fake } = setup();
        host.open({ columns: 80, rows: 24 });
        host.close();
        fake.fireExit(0);

        vi.advanceTimersByTime(KILL_ESCALATION_MS * 2);
        expect(fake.kills).toEqual([undefined]);
    });

    it("does not respawn a shell when open() is called after close()", () => {
        // `opened === false` alone only means "not currently open"; without a
        // separate disposed flag a stray open() silently starts a new shell in
        // a terminal the user believes is dead.
        const { host, spawn } = setup();
        host.open({ columns: 80, rows: 24 });
        host.close();
        host.open({ columns: 80, rows: 24 });
        expect(spawn).toHaveBeenCalledTimes(1);
    });

    it("does not respawn a shell when open() is called after exit", () => {
        const { host, spawn, fake } = setup();
        host.open({ columns: 80, rows: 24 });
        fake.fireExit(0);
        host.open({ columns: 80, rows: 24 });
        expect(spawn).toHaveBeenCalledTimes(1);
    });

    it("reads watermarks from the injected config at open()", () => {
        const getConfig = vi.fn(() => ({
            highWaterMark: 2 * 1024 * 1024,
            lowWaterMark: MIN_WATER_MARK,
        }));
        const { host, fake } = setup(getConfig as never);
        host.open({ columns: 80, rows: 24 });
        expect(getConfig).toHaveBeenCalledTimes(1);

        // 3 MiB crosses the configured 2 MiB high mark but not the 4 MiB default.
        fake.fireData("a".repeat(3 * 1024 * 1024));
        expect(fake.proc.pause).toHaveBeenCalledTimes(1);
    });

    it("resumes a paused pty on close so the shell is not killed while blocked", () => {
        const { host, fake } = setup();
        host.open({ columns: 80, rows: 24 });
        fake.fireData("a".repeat(5 * 1024 * 1024));
        expect(fake.proc.pause).toHaveBeenCalledTimes(1);

        host.close();
        expect(fake.proc.resume).toHaveBeenCalledTimes(1);
    });

    it("survives a pause implementation that throws", () => {
        const { host, fake, log } = setup();
        (fake.proc.pause as ReturnType<typeof vi.fn>).mockImplementation(() => {
            throw new Error("pause kaboom");
        });
        host.open({ columns: 80, rows: 24 });
        expect(() =>
            fake.fireData("a".repeat(5 * 1024 * 1024))
        ).not.toThrow();
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("pause error")
        );
    });

    it("tolerates a proc with no pause/resume support", () => {
        // `pause`/`resume` are optional on the interface so older fakes stay
        // valid; the bookkeeping must not assume they exist.
        const registry = new TerminalRegistry();
        const terminal = fakeTerminal("pty");
        registry.add(terminal);
        let dataCb: ((d: string) => void) | undefined;
        const proc: PtyProcess = {
            onData: (cb) => {
                dataCb = cb;
            },
            onExit: () => {},
            write: () => {},
            kill: () => {},
        };
        const host = new PtyTerminalHost({
            getTerminal: () => terminal,
            registry,
            getActiveTerminal: () => undefined,
            spawn: () => proc,
            shell: "/bin/zsh",
            args: ["-i"],
            cwd: "/tmp",
            env: {},
        });
        host.open({ columns: 80, rows: 24 });
        expect(() => dataCb?.("a".repeat(5 * 1024 * 1024))).not.toThrow();
        expect(() => vi.runAllTimers()).not.toThrow();
    });
});
