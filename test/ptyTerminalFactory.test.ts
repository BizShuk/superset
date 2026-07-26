import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PtyProcess } from "../src/terminals/ptyTerminalHost";

// The factory reaches for both `vscode` and the native `node-pty` binding at
// import time. Neither is available under vitest, so both are faked; the
// factory's own logic (env sanitising, host bookkeeping) is what is under test.
const created: Array<{ name: string; pty: unknown; disposed: boolean }> = [];
const showErrorMessage = vi.fn();

vi.mock("node-pty", () => ({ spawn: () => ({}) }));
vi.mock("vscode", () => ({
    window: {
        showErrorMessage,
        createTerminal: ({ name, pty }: { name: string; pty: unknown }) => {
            const terminal = { name, pty, disposed: false };
            created.push(terminal);
            return terminal;
        },
    },
    workspace: {
        getConfiguration: () => ({ get: () => undefined }),
    },
}));

const { PtyTerminalFactory, buildShellEnv } = await import(
    "../src/terminals/ptyTerminalFactory"
);
const { TerminalRegistry } = await import("../src/terminals/terminalRegistry");

describe("buildShellEnv", () => {
    it("strips the Electron and VSCode handshake variables", () => {
        // `ELECTRON_RUN_AS_NODE` leaking into a user shell breaks every
        // node-based tool they run, because Electron's node treats it as a
        // mode switch rather than an ordinary variable.
        const env = buildShellEnv({
            PATH: "/usr/bin",
            ELECTRON_RUN_AS_NODE: "1",
            ELECTRON_NO_ATTACH_CONSOLE: "1",
            VSCODE_PID: "123",
            VSCODE_IPC_HOOK: "/tmp/sock",
            NODE_OPTIONS: "--max-old-space-size=8192",
        });
        expect(env.PATH).toBe("/usr/bin");
        expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
        expect(env.ELECTRON_NO_ATTACH_CONSOLE).toBeUndefined();
        expect(env.VSCODE_PID).toBeUndefined();
        expect(env.VSCODE_IPC_HOOK).toBeUndefined();
        expect(env.NODE_OPTIONS).toBeUndefined();
    });

    it("keeps ordinary user variables", () => {
        const env = buildShellEnv({
            HOME: "/Users/x",
            SHELL: "/bin/zsh",
            LANG: "en_US.UTF-8",
            MY_TOKEN: "secret",
        });
        expect(env).toMatchObject({
            HOME: "/Users/x",
            SHELL: "/bin/zsh",
            LANG: "en_US.UTF-8",
            MY_TOKEN: "secret",
        });
    });

    it("sets an explicit TERM", () => {
        // The extension host frequently has no TERM at all, and a TUI that
        // cannot identify the terminal renders garbage or blocks waiting for
        // a capability response.
        const env = buildShellEnv({});
        expect(env.TERM).toBe("xterm-256color");
        expect(env.COLORTERM).toBe("truecolor");
    });

    it("overrides an inherited TERM rather than trusting it", () => {
        const env = buildShellEnv({ TERM: "dumb" });
        expect(env.TERM).toBe("xterm-256color");
    });
});

describe("PtyTerminalFactory host bookkeeping", () => {
    beforeEach(() => {
        created.length = 0;
        showErrorMessage.mockClear();
    });

    function makeFactory() {
        const killed: string[] = [];
        const spawn = vi.fn(
            (): PtyProcess => ({
                onData: () => {},
                onExit: () => {},
                write: () => {},
                kill: () => killed.push("kill"),
            })
        );
        const factory = new PtyTerminalFactory({
            registry: new TerminalRegistry(),
            getWatched: () => undefined,
            isRecentlyActive: () => false,
            spawn,
            log: () => {},
        });
        return { factory, killed };
    }

    it("reports terminals it created as PTY-backed", () => {
        const { factory } = makeFactory();
        const t = factory.spawn("one", "/tmp");
        expect(factory.isPtyBacked(t)).toBe(true);
    });

    it("does not claim a terminal it did not create", () => {
        const { factory } = makeFactory();
        expect(factory.isPtyBacked({ name: "foreign" } as never)).toBe(false);
    });

    it("forget() sheds the reference so closed terminals are not retained", () => {
        // A set that never shed entries kept every terminal ever spawned
        // strongly referenced for the life of the window.
        const { factory } = makeFactory();
        const t = factory.spawn("one", "/tmp");
        factory.forget(t);
        expect(factory.isPtyBacked(t)).toBe(false);
    });

    it("forget() on an unknown terminal is a no-op", () => {
        const { factory } = makeFactory();
        expect(() => factory.forget({ name: "ghost" } as never)).not.toThrow();
    });

    it("dispose() closes every host it still owns", () => {
        // Deactivating the extension previously left the shells running, so
        // each activation cycle stacked another generation of orphans.
        const { factory, killed } = makeFactory();
        const a = factory.spawn("a", "/tmp");
        const b = factory.spawn("b", "/tmp");
        // Open both so they actually hold a process to kill.
        for (const t of [a, b]) {
            (t as unknown as { pty: { open: (d: unknown) => void } }).pty.open({
                columns: 80,
                rows: 24,
            });
        }
        factory.dispose();
        expect(killed).toHaveLength(2);
        expect(factory.isPtyBacked(a)).toBe(false);
        expect(factory.isPtyBacked(b)).toBe(false);
    });

    it("dispose() does not close hosts already forgotten", () => {
        const { factory, killed } = makeFactory();
        const a = factory.spawn("a", "/tmp");
        (a as unknown as { pty: { open: (d: unknown) => void } }).pty.open({
            columns: 80,
            rows: 24,
        });
        factory.forget(a);
        factory.dispose();
        expect(killed).toHaveLength(0);
    });

    it("shows the PTY spawn error instead of leaving a silent terminal", () => {
        const factory = new PtyTerminalFactory({
            registry: new TerminalRegistry(),
            getWatched: () => undefined,
            isRecentlyActive: () => false,
            spawn: () => {
                throw new Error("posix_spawnp failed");
            },
            log: () => {},
        });
        const terminal = factory.spawn("broken", "/tmp");
        const pty = (terminal as unknown as {
            pty: { open: (dimensions: unknown) => void };
        }).pty;

        expect(() => pty.open({ columns: 80, rows: 24 })).not.toThrow();
        expect(showErrorMessage).toHaveBeenCalledWith(
            "Superset: 無法啟動 PTY terminal：posix_spawnp failed"
        );
    });
});
