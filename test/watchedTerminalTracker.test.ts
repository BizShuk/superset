import { describe, it, expect } from "vitest";
import { WatchedTerminalTracker } from "../src/terminals/watchedTerminalTracker";

// Simple controllable clock.
function fakeClock(start = 1000) {
    let t = start;
    return {
        now: () => t,
        advance: (ms: number) => {
            t += ms;
        },
    };
}

describe("WatchedTerminalTracker", () => {
    const A = { id: "a" };
    const B = { id: "b" };

    it("starts with the provided initial terminal", () => {
        const tracker = new WatchedTerminalTracker({ initial: A });
        expect(tracker.watched).toBe(A);
    });

    it("defaults to undefined when no initial given", () => {
        const tracker = new WatchedTerminalTracker<typeof A>();
        expect(tracker.watched).toBeUndefined();
    });

    it("updates the watched terminal on setWatched", () => {
        const tracker = new WatchedTerminalTracker<typeof A>();
        tracker.setWatched(A);
        expect(tracker.watched).toBe(A);
        tracker.setWatched(B);
        expect(tracker.watched).toBe(B);
    });

    it("is a no-op when setting the same terminal (no stamp)", () => {
        const clock = fakeClock();
        const tracker = new WatchedTerminalTracker({ now: clock.now, initial: A });
        tracker.setWatched(A); // same → no stamp recorded
        clock.advance(10);
        // A was never switched away from, so it has no last-active stamp.
        expect(tracker.isRecentlyActive(A)).toBe(false);
    });

    it("stamps the previous terminal when switching away", () => {
        const clock = fakeClock();
        const tracker = new WatchedTerminalTracker({ now: clock.now, initial: A });
        tracker.setWatched(B); // switching away from A stamps A
        clock.advance(100);
        expect(tracker.isRecentlyActive(A)).toBe(true);
    });

    it("reports a terminal stale once the window passes", () => {
        const clock = fakeClock();
        const tracker = new WatchedTerminalTracker({ now: clock.now, initial: A });
        tracker.setWatched(B);
        clock.advance(250); // exactly the window → not strictly less than
        expect(tracker.isRecentlyActive(A)).toBe(false);
    });

    it("honours a custom recency window", () => {
        const clock = fakeClock();
        const tracker = new WatchedTerminalTracker({ now: clock.now, initial: A });
        tracker.setWatched(B);
        clock.advance(400);
        expect(tracker.isRecentlyActive(A, 500)).toBe(true);
        expect(tracker.isRecentlyActive(A, 300)).toBe(false);
    });

    it("returns false for a terminal that was never watched", () => {
        const tracker = new WatchedTerminalTracker<typeof A>();
        expect(tracker.isRecentlyActive(A)).toBe(false);
    });
});
