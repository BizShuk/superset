import { describe, it, expect, vi } from "vitest";
import { ActivityCoordinator } from "../src/terminals/activitySource";
import type {
    ActivityEvent,
    ActivitySource,
} from "../src/terminals/activitySource";
import { TerminalRegistry } from "../src/terminals/terminalRegistry";
import type { TerminalHandle } from "../src/terminals/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

/** A source whose emissions the test drives by hand. */
function manualSource() {
    let emit: ((e: ActivityEvent) => void) | undefined;
    const off = vi.fn(() => {
        emit = undefined;
    });
    const source: ActivitySource = (e) => {
        emit = e;
        return off;
    };
    return {
        source,
        off,
        fire: (terminal: TerminalHandle, reason = "test") =>
            emit?.({ terminal, reason }),
        get subscribed() {
            return emit !== undefined;
        },
    };
}

/**
 * Terminals are addressed by role name (`"a"` / `"b"`) rather than by handle,
 * because the handles are created inside `setup` — passing them in would be a
 * temporal-dead-zone reference at the call site.
 */
type Role = "a" | "b";

function setup(
    opts: {
        active?: Role;
        recentlyActive?: Role;
        sources?: ActivitySource[];
    } = {}
) {
    const registry = new TerminalRegistry();
    const a = fakeTerminal("a");
    const b = fakeTerminal("b");
    registry.add(a);
    registry.add(b);
    const byRole = (role: Role | undefined) =>
        role === "a" ? a : role === "b" ? b : undefined;
    const log = vi.fn();
    const source = manualSource();
    const coordinator = new ActivityCoordinator({
        registry,
        getActiveTerminal: () => byRole(opts.active),
        isRecentlyActive: (t) => t === byRole(opts.recentlyActive),
        sources: opts.sources ?? [source.source],
        log,
    });
    return { registry, coordinator, source, a, b, log };
}

describe("ActivityCoordinator", () => {
    it("marks a background terminal unseen", () => {
        const { registry, coordinator, source, a, b } = setup({ active: "b" });
        coordinator.start();
        source.fire(a);
        expect(registry.isUnseen(a)).toBe(true);
    });

    it("does not mark the focused terminal", () => {
        const { registry, coordinator, source, b } = setup({ active: "b" });
        coordinator.start();
        source.fire(b);
        expect(registry.isUnseen(b)).toBe(false);
    });

    it("does not mark a recently focused terminal", () => {
        // Trailing output from a terminal the user just left is expected and
        // should not pull their attention back.
        const { registry, coordinator, source, a, b } = setup({ active: "b", recentlyActive: "a" });
        coordinator.start();
        source.fire(a);
        expect(registry.isUnseen(a)).toBe(false);
    });

    it("ignores a terminal that is not in the registry", () => {
        const { coordinator, source, b } = setup({ active: "b" });
        coordinator.start();
        const ghost = fakeTerminal("ghost");
        expect(() => source.fire(ghost)).not.toThrow();
    });

    it("logs once per seen-to-unseen flip, not once per event", () => {
        // The predecessor logged on every chunk from the hot suppressed
        // paths, which is what made the diagnostic channel a performance
        // problem in its own right.
        const { coordinator, source, a, b, log } = setup({ active: "b" });
        coordinator.start();
        for (let i = 0; i < 50; i++) {
            source.fire(a);
        }
        const marks = log.mock.calls.filter((c) =>
            String(c[0]).includes("markUnseen")
        );
        expect(marks).toHaveLength(1);
    });

    it("does not log for suppressed events at all", () => {
        const { coordinator, source, b, log } = setup({ active: "b" });
        coordinator.start();
        for (let i = 0; i < 50; i++) {
            source.fire(b);
        }
        expect(log).not.toHaveBeenCalled();
    });

    it("re-marks after the user views and leaves the terminal again", () => {
        const { registry, coordinator, source, a, b } = setup({ active: "b" });
        coordinator.start();
        source.fire(a);
        expect(registry.isUnseen(a)).toBe(true);
        registry.clearUnseen(a);
        source.fire(a);
        expect(registry.isUnseen(a)).toBe(true);
    });

    it("fans in every source", () => {
        const s1 = manualSource();
        const s2 = manualSource();
        const { registry, coordinator, a, b } = setup({
            active: "b",
            sources: [s1.source, s2.source],
        });
        coordinator.start();
        expect(s1.subscribed).toBe(true);
        expect(s2.subscribed).toBe(true);
        s2.fire(a);
        expect(registry.isUnseen(a)).toBe(true);
    });

    it("start() is idempotent", () => {
        const s1 = manualSource();
        const subscribe = vi.fn(s1.source);
        const { coordinator } = setup({ sources: [subscribe] });
        coordinator.start();
        coordinator.start();
        expect(subscribe).toHaveBeenCalledTimes(1);
    });

    it("stop() unsubscribes every source", () => {
        const s1 = manualSource();
        const s2 = manualSource();
        const { coordinator } = setup({ sources: [s1.source, s2.source] });
        coordinator.start();
        coordinator.stop();
        expect(s1.off).toHaveBeenCalledTimes(1);
        expect(s2.off).toHaveBeenCalledTimes(1);
    });

    it("stop() then start() re-subscribes", () => {
        const { registry, coordinator, source, a, b } = setup({ active: "b" });
        coordinator.start();
        coordinator.stop();
        coordinator.start();
        source.fire(a);
        expect(registry.isUnseen(a)).toBe(true);
    });

    it("keeps unsubscribing when one source's teardown throws", () => {
        const bad: ActivitySource = () => () => {
            throw new Error("teardown failed");
        };
        const good = manualSource();
        const { coordinator, log } = setup({ sources: [bad, good.source] });
        coordinator.start();
        expect(() => coordinator.stop()).not.toThrow();
        expect(good.off).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("unsubscribe error")
        );
    });

    it("stops marking after stop()", () => {
        const { registry, coordinator, source, a, b } = setup({ active: "b" });
        coordinator.start();
        coordinator.stop();
        source.fire(a);
        expect(registry.isUnseen(a)).toBe(false);
    });
});
