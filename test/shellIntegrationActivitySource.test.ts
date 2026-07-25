import { describe, it, expect, vi } from "vitest";
import { createShellIntegrationActivitySource } from "../src/terminals/shellIntegrationActivitySource";
import type { ShellExecutionLifecycleEvent } from "../src/terminals/shellIntegrationActivitySource";
import type { ActivityEvent } from "../src/terminals/activitySource";
import type { TerminalHandle } from "../src/terminals/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

function setup(opts: { throwOnUnsubscribe?: boolean } = {}) {
    let startCb: ((e: ShellExecutionLifecycleEvent) => void) | undefined;
    let endCb: ((e: ShellExecutionLifecycleEvent) => void) | undefined;
    const offStart = vi.fn(() => {
        if (opts.throwOnUnsubscribe) {
            throw new Error("start unsubscribe blew up");
        }
        startCb = undefined;
    });
    const offEnd = vi.fn(() => {
        endCb = undefined;
    });
    const log = vi.fn();
    const events: ActivityEvent[] = [];
    const source = createShellIntegrationActivitySource({
        onDidStart: (cb) => {
            startCb = cb;
            return offStart;
        },
        onDidEnd: (cb) => {
            endCb = cb;
            return offEnd;
        },
        log,
    });
    const off = source((e) => events.push(e));
    return {
        events,
        log,
        off,
        offStart,
        offEnd,
        fireStart: (e: ShellExecutionLifecycleEvent) => startCb?.(e),
        fireEnd: (e: ShellExecutionLifecycleEvent) => endCb?.(e),
    };
}

describe("createShellIntegrationActivitySource", () => {
    it("emits on execution start", () => {
        const { events, fireStart } = setup();
        const a = fakeTerminal("a");
        fireStart({ terminal: a, commandLine: "npm test" });
        expect(events).toHaveLength(1);
        expect(events[0].terminal).toBe(a);
        expect(events[0].reason).toContain("started");
        expect(events[0].reason).toContain("npm test");
    });

    it("emits on execution end with the exit code", () => {
        const { events, fireEnd } = setup();
        const a = fakeTerminal("a");
        fireEnd({ terminal: a, commandLine: "npm test", exitCode: 1 });
        expect(events).toHaveLength(1);
        expect(events[0].reason).toContain("finished");
        expect(events[0].reason).toContain("exit=1");
    });

    it("emits an end event even when the shell reported no exit code", () => {
        const { events, fireEnd } = setup();
        fireEnd({ terminal: fakeTerminal("a"), commandLine: "vim" });
        expect(events).toHaveLength(1);
        expect(events[0].reason).not.toContain("exit=");
    });

    it("includes exit=0 for a successful command", () => {
        // `exitCode: 0` is falsy — a truthiness check here would drop it.
        const { events, fireEnd } = setup();
        fireEnd({ terminal: fakeTerminal("a"), commandLine: "ls", exitCode: 0 });
        expect(events[0].reason).toContain("exit=0");
    });

    it("handles a missing command line", () => {
        const { events, fireStart } = setup();
        fireStart({ terminal: fakeTerminal("a") });
        expect(events[0].reason).toContain("<unknown>");
    });

    it("collapses whitespace and truncates a long command line", () => {
        const { events, fireStart } = setup();
        fireStart({
            terminal: fakeTerminal("a"),
            commandLine: `  echo   one\n  two   ${"x".repeat(80)}  `,
        });
        const reason = events[0].reason;
        expect(reason).not.toContain("\n");
        expect(reason).not.toContain("  ");
        expect(reason).toContain("…");
    });

    it("reports both edges of one execution", () => {
        const { events, fireStart, fireEnd } = setup();
        const a = fakeTerminal("a");
        fireStart({ terminal: a, commandLine: "sleep 5" });
        fireEnd({ terminal: a, commandLine: "sleep 5", exitCode: 0 });
        expect(events).toHaveLength(2);
    });

    it("unsubscribes from both events", () => {
        const { off, offStart, offEnd } = setup();
        off();
        expect(offStart).toHaveBeenCalledTimes(1);
        expect(offEnd).toHaveBeenCalledTimes(1);
    });

    it("still unsubscribes the end event when the start unsubscribe throws", () => {
        // A half-torn-down source would keep emitting into a dead coordinator
        // after the feature is disposed.
        const { off, offEnd, log } = setup({ throwOnUnsubscribe: true });
        expect(() => off()).not.toThrow();
        expect(offEnd).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("unsubscribe start error")
        );
    });

    it("stops emitting after unsubscribe", () => {
        const { events, off, fireStart } = setup();
        off();
        fireStart({ terminal: fakeTerminal("a"), commandLine: "ls" });
        expect(events).toEqual([]);
    });
});
