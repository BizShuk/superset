import { describe, it, expect, vi } from "vitest";
import { PtyTerminalHost } from "../src/terminals/ptyTerminalHost";
import type {
    PtyProcess,
    PtySpawner,
    TerminalHandle,
} from "../src/terminals/ptyTerminalHost";
import type { TerminalRegistry } from "../src/terminals/terminalRegistry";

/**
 * In-memory `PtyProcess` used to lock down the interface contract.
 * Records every call so tests can assert on the sequence, and lets
 * tests fire the callbacks to exercise the host's plumbing without
 * touching a real PTY.
 */
class MockPtyProcess implements PtyProcess {
    writes: string[] = [];
    kills = 0;
    resizes: Array<{ cols: number; rows: number }> = [];
    private dataCb?: (data: string) => void;
    private exitCb?: (code: number) => void;
    supportsResize = true;

    onData(cb: (data: string) => void): void {
        this.dataCb = cb;
    }
    onExit(cb: (code: number) => void): void {
        this.exitCb = cb;
    }
    write(data: string): void {
        this.writes.push(data);
    }
    kill(): void {
        this.kills++;
    }
    resize(cols: number, rows: number): void {
        if (!this.supportsResize) return;
        this.resizes.push({ cols, rows });
    }

    // Test helpers
    emitData(data: string): void {
        this.dataCb?.(data);
    }
    emitExit(code: number): void {
        this.exitCb?.(code);
    }
}

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: () => {}, dispose: () => {} };
}

function fakeRegistry(terminal: TerminalHandle): {
    registry: TerminalRegistry;
    seen: TerminalHandle[];
} {
    const seen: TerminalHandle[] = [];
    const registry = {
        markUnseen(t: TerminalHandle) {
            seen.push(t);
        },
    } as unknown as TerminalRegistry;
    return { registry, seen };
}

function makeHost(overrides: {
    proc: MockPtyProcess;
    terminal: TerminalHandle;
    active?: TerminalHandle;
    recentlyActive?: boolean;
    isRecentlyActive?: (t: TerminalHandle) => boolean;
}) {
    const proc = overrides.proc;
    const spawn: PtySpawner = () => proc;
    const { registry, seen } = fakeRegistry(overrides.terminal);
    const log = vi.fn();
    const host = new PtyTerminalHost({
        getTerminal: () => overrides.terminal,
        registry,
        getActiveTerminal: () => overrides.active,
        spawn,
        shell: "/bin/zsh",
        args: ["-i"],
        cwd: "/tmp",
        env: {},
        isRecentlyActive:
            overrides.isRecentlyActive ??
            ((t) => overrides.recentlyActive === true && t === overrides.terminal),
        log,
    });
    return { host, proc, registry, seen, log };
}

describe("PtyProcess interface contract (via PtyTerminalHost)", () => {
    it("open() spawns a process with the supplied dimensions and pipes output", () => {
        const proc = new MockPtyProcess();
        const { host } = makeHost({
            proc,
            terminal: fakeTerminal("t1"),
        });
        host.open({ columns: 80, rows: 24 });

        proc.emitData("hello");
        // onWrite listener fires synchronously on the emit.
        const writes: string[] = [];
        host.onWrite((d) => writes.push(d));
        proc.emitData("world");
        expect(writes).toEqual(["world"]);
    });

    it("handleInput forwards typed input to the process", () => {
        const proc = new MockPtyProcess();
        const { host } = makeHost({
            proc,
            terminal: fakeTerminal("t1"),
        });
        host.open({ columns: 80, rows: 24 });
        host.handleInput("ls -la\n");
        expect(proc.writes).toEqual(["ls -la\n"]);
    });

    it("setDimensions calls resize on the process", () => {
        const proc = new MockPtyProcess();
        const { host } = makeHost({
            proc,
            terminal: fakeTerminal("t1"),
        });
        host.open({ columns: 80, rows: 24 });
        host.setDimensions({ columns: 120, rows: 40 });
        expect(proc.resizes).toEqual([{ cols: 120, rows: 40 }]);
    });

    it("close() kills the process and fires onClose listeners", () => {
        const proc = new MockPtyProcess();
        const { host } = makeHost({
            proc,
            terminal: fakeTerminal("t1"),
        });
        host.open({ columns: 80, rows: 24 });
        const closeCodes: Array<number | void> = [];
        host.onClose((c) => closeCodes.push(c));
        host.close();
        expect(proc.kills).toBe(1);
        expect(closeCodes).toEqual([undefined]);
    });

    it("close() is idempotent: a second call does not double-kill", () => {
        const proc = new MockPtyProcess();
        const { host } = makeHost({
            proc,
            terminal: fakeTerminal("t1"),
        });
        host.open({ columns: 80, rows: 24 });
        host.close();
        host.close();
        expect(proc.kills).toBe(1);
    });

    it("open() is idempotent: a second call does not re-spawn", () => {
        const proc = new MockPtyProcess();
        const spawn = vi.fn(() => proc);
        const terminal = fakeTerminal("t1");
        const { registry } = fakeRegistry(terminal);
        const host = new PtyTerminalHost({
            getTerminal: () => terminal,
            registry,
            getActiveTerminal: () => undefined,
            spawn,
            shell: "/bin/zsh",
            args: ["-i"],
            cwd: "/tmp",
            env: {},
        });
        host.open({ columns: 80, rows: 24 });
        host.open({ columns: 80, rows: 24 });
        expect(spawn).toHaveBeenCalledOnce();
    });

    it("markUnseen is invoked for non-active output", () => {
        const proc = new MockPtyProcess();
        const terminal = fakeTerminal("t1");
        const { host, seen } = makeHost({
            proc,
            terminal,
            active: fakeTerminal("other"),
        });
        host.open({ columns: 80, rows: 24 });
        proc.emitData("data");
        expect(seen).toEqual([terminal]);
    });

    it("markUnseen is NOT invoked for the active terminal", () => {
        const proc = new MockPtyProcess();
        const terminal = fakeTerminal("t1");
        const { host, seen } = makeHost({
            proc,
            terminal,
            active: terminal,
        });
        host.open({ columns: 80, rows: 24 });
        proc.emitData("data");
        expect(seen).toEqual([]);
    });

    it("markUnseen is NOT invoked for a recently-active terminal", () => {
        const proc = new MockPtyProcess();
        const terminal = fakeTerminal("t1");
        const { host, seen } = makeHost({
            proc,
            terminal,
            active: fakeTerminal("other"),
            isRecentlyActive: (t) => t === terminal,
        });
        host.open({ columns: 80, rows: 24 });
        proc.emitData("data");
        expect(seen).toEqual([]);
    });

    it("process exit fires onClose with the exit code", () => {
        const proc = new MockPtyProcess();
        const { host } = makeHost({
            proc,
            terminal: fakeTerminal("t1"),
        });
        host.open({ columns: 80, rows: 24 });
        const codes: Array<number | void> = [];
        host.onClose((c) => codes.push(c));
        proc.emitExit(0);
        expect(codes).toEqual([0]);
    });

    it("handleInput before open() is a no-op (no process to write to)", () => {
        const proc = new MockPtyProcess();
        const { host } = makeHost({
            proc,
            terminal: fakeTerminal("t1"),
        });
        // open() NOT called
        host.handleInput("data");
        expect(proc.writes).toEqual([]);
    });

    it("setDimensions before open() is a no-op", () => {
        const proc = new MockPtyProcess();
        const { host } = makeHost({
            proc,
            terminal: fakeTerminal("t1"),
        });
        host.setDimensions({ columns: 120, rows: 40 });
        expect(proc.resizes).toEqual([]);
    });
});
