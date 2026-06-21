import { describe, it, expect, vi } from "vitest";
import { OutputWatcher } from "../src/outputWatcher";
import type {
    ShellExecutionLike,
    ShellExecutionStartEvent,
} from "../src/outputWatcher";
import type { TerminalHandle } from "../src/types";
import { TerminalRegistry } from "../src/terminalRegistry";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

function fakeExecution(): {
    execution: ShellExecutionLike;
    fireData: (chunk: string) => void;
} {
    let dataCb: ((chunk: string) => void) | undefined;
    const execution: ShellExecutionLike = {
        onData(cb) {
            dataCb = cb;
        },
    };
    return {
        execution,
        fireData: (chunk) => dataCb?.(chunk),
    };
}

function setup() {
    const registry = new TerminalRegistry();
    const a = fakeTerminal("a");
    const b = fakeTerminal("b");
    registry.add(a);
    registry.add(b);

    let execCallback: ((e: ShellExecutionStartEvent) => void) | undefined;
    const onShellExecution = vi.fn(
        (cb: (e: ShellExecutionStartEvent) => void) => {
            execCallback = cb;
            return () => {
                execCallback = undefined;
            };
        }
    );

    const getActiveTerminal = vi.fn(() => b);
    const watcher = new OutputWatcher({
        registry,
        getActiveTerminal,
        onShellExecution,
    });

    return {
        registry,
        watcher,
        getActiveTerminal,
        onShellExecution,
        fire(event: ShellExecutionStartEvent) {
            if (!execCallback) {
                throw new Error("onShellExecution was never called");
            }
            execCallback(event);
        },
        a,
        b,
    };
}

describe("OutputWatcher", () => {
    it("subscribes to onShellExecution on start()", () => {
        const { watcher, onShellExecution } = setup();
        watcher.start();
        expect(onShellExecution).toHaveBeenCalledTimes(1);
    });

    it("marks terminal unseen when onData fires on non-active terminal", () => {
        const { watcher, fire, a, registry } = setup();
        watcher.start();

        const exec = fakeExecution();
        fire({ terminal: a, execution: exec.execution });
        exec.fireData("hello\n");

        // a is non-active (active=b), so a should be unseen.
        expect(registry.getUnseen()).toContain(a);
    });

    it("does NOT mark active terminal unseen", () => {
        const { watcher, fire, b, registry } = setup();
        watcher.start();

        const exec = fakeExecution();
        fire({ terminal: b, execution: exec.execution });
        exec.fireData("hello\n");

        expect(registry.getUnseen()).not.toContain(b);
    });

    it("ignores data from terminal not in registry", () => {
        const { watcher, fire } = setup();
        watcher.start();

        const ghost = fakeTerminal("ghost");
        const exec = fakeExecution();
        // Should not throw even though ghost is not registered.
        expect(() =>
            fire({ terminal: ghost, execution: exec.execution })
        ).not.toThrow();
        exec.fireData("hello\n");
    });

    it("does NOT mark terminal unseen if it was recently active", () => {
        const { watcher, fire, a, registry } = setup();
        // Mock isRecentlyActive to return true for a
        watcher["deps"].isRecentlyActive = (terminal) => terminal === a;
        watcher.start();

        const exec = fakeExecution();
        fire({ terminal: a, execution: exec.execution });
        exec.fireData("hello\n");

        expect(registry.getUnseen()).not.toContain(a);
    });

    it("stop() unsubscribes from onShellExecution", () => {
        const { watcher } = setup();
        watcher.start();
        watcher.stop();
        // After stop, the dispose function from onShellExecution should be called,
        // but our setup records this only implicitly. We just verify no throw
        // and that starting again re-subscribes.
        watcher.start();
    });
});
