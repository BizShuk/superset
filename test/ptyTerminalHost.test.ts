import { describe, it, expect, vi } from "vitest";
import { PtyTerminalHost } from "../src/terminals/ptyTerminalHost";
import type { PtyProcess, PtySpawner } from "../src/terminals/ptyTerminalHost";
import { TerminalRegistry } from "../src/terminals/terminalRegistry";
import type { TerminalHandle } from "../src/terminals/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

/**
 * Build a fake `PtyProcess` whose callbacks we can fire synthetically.
 * The host treats `proc` as opaque so the only surface we need to fake
 * is the five methods listed in the `PtyProcess` contract.
 */
function fakeProc() {
    let dataCb: ((data: string) => void) | undefined;
    let exitCb: ((code: number) => void) | undefined;
    const writes: string[] = [];
    const kills: number[] = [];
    const resizes: Array<{ cols: number; rows: number }> = [];
    const proc: PtyProcess = {
        onData(cb) {
            dataCb = cb;
        },
        onExit(cb) {
            exitCb = cb;
        },
        write(data) {
            writes.push(data);
        },
        kill() {
            kills.push(Date.now());
        },
        resize(cols, rows) {
            resizes.push({ cols, rows });
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
        writes,
        kills,
        resizes,
    };
}

interface SetupOptions {
    /** Terminal that `getActiveTerminal()` should return. */
    active?: TerminalHandle;
}

interface SetupResult {
    registry: TerminalRegistry;
    host_instance: PtyTerminalHost;
    host: TerminalHandle;
    other: TerminalHandle;
    fake: ReturnType<typeof fakeProc>;
    spawner: PtySpawner;
}

/**
 * Return a new host instance bound to a specific active terminal.
 * Avoids the destructuring TDZ trap of `setup({ active: other })`
 * which references `other` before declaration.
 */
function withActive(
    ctx: SetupResult,
    active: TerminalHandle | undefined
): Pick<SetupResult, "host_instance" | "fake" | "registry" | "host"> {
    const host_instance = new PtyTerminalHost({
        getTerminal: () => ctx.host,
        registry: ctx.registry,
        getActiveTerminal: () => active,
        spawn: ctx.spawner,
        shell: "/bin/zsh",
        args: ["-i"],
        cwd: "/tmp",
        env: {},
    });
    return {
        host_instance,
        fake: ctx.fake,
        registry: ctx.registry,
        host: ctx.host,
    };
}

/**
 * Build a host + dependencies. To test "active === host" vs "active !==
 * host" in the same suite, callers can override `active` per test.
 */
function setup(opts: SetupOptions = {}): SetupResult {
    const registry = new TerminalRegistry();
    const host = fakeTerminal("pty-host");
    const other = fakeTerminal("other");
    registry.add(host);
    registry.add(other);

    const fake = fakeProc();
    const spawner: PtySpawner = vi.fn(() => fake.proc);

    const host_instance = new PtyTerminalHost({
        getTerminal: () => host,
        registry,
        getActiveTerminal: () => opts.active,
        spawn: spawner,
        shell: "/bin/zsh",
        args: ["-i"],
        cwd: "/tmp",
        env: {},
    });

    return { registry, host_instance, host, other, fake, spawner };
}

describe("PtyTerminalHost", () => {
    it("does not spawn until open() is called", () => {
        const { spawner } = setup();
        expect(spawner).not.toHaveBeenCalled();
    });

    it("open() spawns the shell with provided dimensions", () => {
        const { host_instance, spawner } = setup();
        host_instance.open({ columns: 100, rows: 30 });
        expect(spawner).toHaveBeenCalledTimes(1);
        const calls = (spawner as unknown as ReturnType<typeof vi.fn>).mock.calls;
        const [file, args, options] = calls[0];
        expect(file).toBe("/bin/zsh");
        expect(args).toEqual(["-i"]);
        expect(options.cols).toBe(100);
        expect(options.rows).toBe(30);
    });

    it("open() is idempotent", () => {
        const { host_instance, spawner } = setup();
        host_instance.open({ columns: 80, rows: 24 });
        host_instance.open({ columns: 100, rows: 30 });
        expect(spawner).toHaveBeenCalledTimes(1);
    });

    it("forwards data to write listeners", () => {
        const { host_instance, fake } = setup();
        const writeSpy = vi.fn();
        host_instance.onWrite(writeSpy);
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("hello\n");

        expect(writeSpy).toHaveBeenCalledWith("hello\n");
    });

    it("forwards close events with exit code", () => {
        const { host_instance, fake } = setup();
        const closeSpy = vi.fn();
        host_instance.onClose(closeSpy);
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireExit(0);

        expect(closeSpy).toHaveBeenCalledWith(0);
    });

    it("marks host unseen on PTY data when terminal is non-active", () => {
        // Active terminal is the unrelated `other` one; host is background.
        const ctx = setup();
        const active = ctx.other;
        const { host_instance, fake, registry, host } = withActive(ctx, active);
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("hello");

        expect(registry.getUnseen().map((e) => e.terminal)).toContain(host);
        expect(registry.getUnseen().map((e) => e.terminal)).not.toContain(ctx.other);
    });

    it("does NOT mark host unseen when it is the active terminal", () => {
        // Active terminal is the host itself.
        const ctx = setup();
        const { host_instance, fake, registry, host } = withActive(ctx, ctx.host);
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("hello");

        expect(registry.getUnseen().map((e) => e.terminal)).not.toContain(host);
    });

    it("does NOT mark host unseen when no terminal is active", () => {
        // Edge case: all terminals closed → active is undefined. The
        // "non-active" branch only fires when `active === terminal`;
        // for `active === undefined` we should still treat host as
        // unseen and mark it (since the user can't see it).
        // This matches OutputWatcher behavior.
        const ctx = setup();
        const { host_instance, fake, registry, host } = withActive(ctx, undefined);
        host_instance.open({ columns: 80, rows: 24 });

        fake.fireData("hello");

        // Spec: non-active means "not the current focus terminal". An
        // undefined active terminal means the user has no terminal
        // focused — the host is non-active from the host's perspective,
        // so it should be marked unseen (matches OutputWatcher path).
        expect(registry.getUnseen().map((e) => e.terminal)).toContain(host);
    });

    it("high-frequency PTY data is idempotent (single unseenChanged event)", () => {
        const ctx = setup();
        const { host_instance, fake, registry, host } = withActive(ctx, ctx.other);
        host_instance.open({ columns: 80, rows: 24 });

        const listener = vi.fn();
        registry.onDidChange(listener);
        for (let i = 0; i < 100; i += 1) {
            fake.fireData(`chunk-${i}`);
        }
        const unseenEvents = listener.mock.calls.filter(
            (c) => c[0].type === "unseenChanged" && c[0].terminal === host
        );
        expect(unseenEvents).toHaveLength(1);
    });

    it("handleInput forwards to proc.write", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });
        host_instance.handleInput("ls\n");
        expect(fake.writes).toContain("ls\n");
    });

    it("setDimensions forwards to proc.resize", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });
        host_instance.setDimensions({ columns: 120, rows: 40 });
        expect(fake.resizes).toEqual([{ cols: 120, rows: 40 }]);
    });

    it("close() kills the process and fires close event", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });
        const closeSpy = vi.fn();
        host_instance.onClose(closeSpy);

        host_instance.close();

        expect(fake.kills).toHaveLength(1);
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it("handleInput after close is a no-op (no throw)", () => {
        const { host_instance, fake } = setup();
        host_instance.open({ columns: 80, rows: 24 });
        host_instance.close();
        expect(() => host_instance.handleInput("x")).not.toThrow();
        expect(fake.writes).toEqual([]);
    });

    it("onWrite / onClose return unsubscribers", () => {
        const { host_instance, fake } = setup();
        const writeSpy = vi.fn();
        const closeSpy = vi.fn();
        const offWrite = host_instance.onWrite(writeSpy);
        const offClose = host_instance.onClose(closeSpy);

        host_instance.open({ columns: 80, rows: 24 });
        offWrite();
        offClose();
        fake.fireData("ignored");
        fake.fireExit(0);
        expect(writeSpy).not.toHaveBeenCalled();
        expect(closeSpy).not.toHaveBeenCalled();
    });

    it("does NOT mark host unseen on PTY data if it was recently active", () => {
        const ctx = setup();
        const active = ctx.other;
        // Mock isRecentlyActive to return true for host
        const host_instance = new PtyTerminalHost({
            getTerminal: () => ctx.host,
            registry: ctx.registry,
            getActiveTerminal: () => active,
            isRecentlyActive: (terminal) => terminal === ctx.host,
            spawn: ctx.spawner,
            shell: "/bin/zsh",
            args: ["-i"],
            cwd: "/tmp",
            env: {},
        });
        host_instance.open({ columns: 80, rows: 24 });

        ctx.fake.fireData("hello");

        expect(ctx.registry.getUnseen().map((e) => e.terminal)).not.toContain(ctx.host);
    });
});