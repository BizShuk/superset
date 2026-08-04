// Shared contract for terminal-activity detection.
//
// Background: the extension only needs one bit per terminal — "did something
// happen here that the user has not looked at". Reading terminal output to get
// that bit means every byte of every terminal crosses the extension-host main
// thread, which is what starves the event loop under high-output commands.
//
// An `ActivitySource` produces the same bit without a data path. Sources are
// deliberately dumb: they report "terminal X did something", and every policy
// decision (is it in the registry, is the user looking at it, was it focused a
// moment ago) lives in one place — `ActivityCoordinator`. Previously that gate
// was copy-pasted into each byte-reading watcher.

import type { TerminalHandle } from "./types";

export interface ActivityEvent {
    readonly terminal: TerminalHandle;
    /** Why the source thinks this is activity. Diagnostics only. */
    readonly reason: string;
}

/**
 * Subscribe to a source. Returns an unsubscribe function.
 *
 * Sources must be safe to start and stop repeatedly, and must never throw
 * synchronously out of `emit` — the coordinator isolates listeners, but a
 * source that dies on its own timer would silently stop reporting.
 */
export type ActivitySource = (emit: (event: ActivityEvent) => void) => () => void;

export interface ActivityCoordinatorDeps {
    readonly registry: {
        has(terminal: TerminalHandle): boolean;
        isUnseen(terminal: TerminalHandle): boolean;
        markUnseen(terminal: TerminalHandle): void;
    };
    readonly getActiveTerminal: () => TerminalHandle | undefined;
    readonly isRecentlyActive?: (terminal: TerminalHandle) => boolean;
    readonly sources: readonly ActivitySource[];
    readonly log?: (msg: string) => void;
}

/**
 * Fans several {@link ActivitySource}s into `registry.markUnseen`, applying
 * the shared suppression policy.
 *
 * Logging discipline: a line is emitted only when the terminal actually flips
 * from seen to unseen. The suppressed paths (`is active`, `recently active`)
 * are the hot ones — an idle-but-focused terminal generates an event every
 * poll — so logging them per event would recreate the output-channel flood
 * that made the diagnostic channel a load-bearing performance problem.
 */
export class ActivityCoordinator {
    private unsubscribes: Array<() => void> = [];

    constructor(private readonly deps: ActivityCoordinatorDeps) {}

    start(): void {
        if (this.unsubscribes.length > 0) {
            return;
        }
        const emit = (event: ActivityEvent) => this.handle(event);
        this.unsubscribes = this.deps.sources.map((source) => source(emit));
    }

    stop(): void {
        for (const off of this.unsubscribes) {
            try {
                off();
            } catch (err) {
                this.deps.log?.(`[activity] unsubscribe error: ${err}`);
            }
        }
        this.unsubscribes = [];
    }

    private handle(event: ActivityEvent): void {
        const { registry, getActiveTerminal, isRecentlyActive, log } =
            this.deps;
        const { terminal } = event;
        if (!registry.has(terminal)) {
            return;
        }
        if (getActiveTerminal() === terminal) {
            return;
        }
        if (isRecentlyActive?.(terminal)) {
            return;
        }
        if (registry.isUnseen(terminal)) {
            return;
        }
        log?.(`[activity] markUnseen("${terminal.name}") ${event.reason}`);
        registry.markUnseen(terminal);
    }
}
