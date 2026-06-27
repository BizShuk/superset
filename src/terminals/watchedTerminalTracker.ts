// "Is the user watching this terminal?" state machine, extracted from the
// terminals feature composition root so it can be unit-tested in isolation.
//
// Generic over the terminal type (no `vscode` import) — the feature passes
// `vscode.Terminal`; tests pass plain objects. The clock is injectable so
// the recency window can be tested deterministically.

const RECENT_ACTIVE_MS = 250;

export interface WatchedTerminalTrackerDeps<T> {
    /** Clock source; defaults to `Date.now`. */
    readonly now?: () => number;
    /** Terminal the user is watching at construction time, if any. */
    readonly initial?: T | undefined;
}

export class WatchedTerminalTracker<T> {
    private readonly now: () => number;
    private current: T | undefined;
    /** When each terminal was last watched (ms epoch). */
    private readonly lastActiveTime = new Map<T, number>();

    constructor(deps: WatchedTerminalTrackerDeps<T> = {}) {
        this.now = deps.now ?? Date.now;
        this.current = deps.initial;
    }

    /** The terminal the user is currently watching, or undefined. */
    get watched(): T | undefined {
        return this.current;
    }

    /**
     * Update the watched terminal. When switching away from a terminal we
     * stamp its last-active time so {@link isRecentlyActive} can tell that
     * output arriving moments later still belongs to a just-focused
     * terminal (and should not be flagged unseen).
     */
    setWatched(next: T | undefined): void {
        if (this.current === next) {
            return;
        }
        if (this.current !== undefined) {
            this.lastActiveTime.set(this.current, this.now());
        }
        this.current = next;
    }

    /** True if `terminal` was the watched one within the recency window. */
    isRecentlyActive(terminal: T, withinMs: number = RECENT_ACTIVE_MS): boolean {
        const t = this.lastActiveTime.get(terminal);
        return t !== undefined && this.now() - t < withinMs;
    }
}
