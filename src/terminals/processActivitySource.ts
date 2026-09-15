// Activity source `A`: process-tree polling.
//
// Detects "this terminal is doing something" by watching each shell's
// descendant processes instead of its output bytes. Costs one `ps` invocation
// per poll for *all* terminals combined, and nothing at all when no terminal
// is tracked. Contrast with any byte-reading path, which pays proportional to
// output volume on the extension-host main thread.
//
// This is the source that covers full-screen TUIs (`claude`, `codex`, `vim`,
// `htop`). Shell integration cannot see inside them — the execution stays open
// for the program's whole lifetime — but the process tree shows the foreground
// child burning CPU, which is exactly the "still working" signal we want.

import type { ActivityEvent, ActivitySource } from "./activitySource";
import type { TerminalHandle } from "./types";
import {
    buildChildIndex,
    CPU_DELTA_THRESHOLD_MS,
    diffSamples,
    parsePsOutput,
    sampleShell,
    type ShellSample,
} from "./processTreeSampler";

/**
 * Poll cadence.
 *
 * Every tick forks a `ps` that walks the whole process table, so the cadence
 * is this source's entire standing cost — it is paid forever, in every window,
 * whether or not the panel is visible or the window is in the foreground. At
 * 1 Hz that was ~86k process spawns a day per window, enough to keep the CPU
 * out of its idle states on a laptop. 30s keeps "that terminal is still
 * working" true without being a wakeup source of its own; the shell-integration
 * source (`B`) still reports command start/end at event latency, so the only
 * thing that waits for this tick is a full-screen TUI's CPU burn.
 */
export const DEFAULT_POLL_INTERVAL_MS = 30_000;

/**
 * Share of the poll window a process must be busy for to count as active.
 *
 * The CPU threshold cannot be a constant once the window is configurable: at
 * 1 Hz, 10ms meant "busy 1% of the interval", but reused unchanged across a
 * 30s window it would mean 0.03% — an idle TUI merely redrawing its prompt
 * would clear it and every terminal would look busy. Scaling with the window
 * keeps the meaning fixed.
 */
const CPU_DUTY_RATIO = 0.01;

/** Threshold for one poll window, never below `ps`'s own resolution. */
export function cpuThresholdFor(intervalMs: number): number {
    return Math.max(
        CPU_DELTA_THRESHOLD_MS,
        Math.round(intervalMs * CPU_DUTY_RATIO)
    );
}

export interface ProcessActivitySourceDeps {
    /** Runs the `ps` snapshot. Injected so tests never spawn a process. */
    readonly runPs: () => Promise<string>;
    /** Terminals currently tracked by the registry. */
    readonly getTerminals: () => readonly TerminalHandle[];
    /**
     * Resolves a terminal's shell pid. `vscode.Terminal.processId` is a
     * `Thenable`, and returns undefined for pseudoterminal-backed terminals
     * (they have no OS-level shell of their own) — those are skipped.
     */
    readonly resolvePid: (
        terminal: TerminalHandle
    ) => Promise<number | undefined>;
    readonly intervalMs?: number;
    readonly log?: (msg: string) => void;
}

/**
 * Build the polling source. Nothing runs until the returned
 * {@link ActivitySource} is subscribed.
 *
 * Overlap safety: the next tick is scheduled only after the current one
 * settles, so a slow or hung `ps` can never stack timers. That matters because
 * `ps` on a machine under heavy load can take far longer than the interval.
 */
export function createProcessActivitySource(
    deps: ProcessActivitySourceDeps
): ActivitySource {
    const intervalMs = deps.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    return (emit) => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        // Previous sample per terminal. Keyed on the handle so a closed
        // terminal's history drops out with the handle itself.
        const previous = new WeakMap<TerminalHandle, ShellSample>();
        // Resolved pids, cached because `processId` is a promise that settles
        // once but would otherwise be awaited on every tick.
        const pids = new WeakMap<TerminalHandle, number>();

        const schedule = () => {
            if (stopped) {
                return;
            }
            timer = setTimeout(() => {
                void tick();
            }, intervalMs);
            // The tick chain reschedules itself forever, so an undisposed
            // source would hold the Node event loop open on its own. Harmless
            // inside the extension host, but it hangs any process that
            // activates the feature without tearing it down. `unref` is absent
            // under fake timers, hence the optional call.
            (timer as { unref?: () => void }).unref?.();
        };

        const tick = async (): Promise<void> => {
            if (stopped) {
                return;
            }
            try {
                await pollOnce({
                    deps,
                    emit,
                    previous,
                    pids,
                    cpuThresholdMs: cpuThresholdFor(intervalMs),
                });
            } catch (err) {
                // A failed poll must not kill the loop — `ps` can fail
                // transiently (EAGAIN under fork pressure) and the next tick
                // should still run.
                deps.log?.(`[activity:proc] poll error: ${err}`);
            }
            schedule();
        };

        schedule();

        return () => {
            stopped = true;
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
        };
    };
}

interface PollContext {
    readonly deps: ProcessActivitySourceDeps;
    readonly emit: (event: ActivityEvent) => void;
    readonly previous: WeakMap<TerminalHandle, ShellSample>;
    readonly pids: WeakMap<TerminalHandle, number>;
    /** Defaults to `ps`'s own resolution when a caller drives one cycle. */
    readonly cpuThresholdMs?: number;
}

/**
 * One poll cycle. Exported for tests so a single deterministic cycle can be
 * driven without touching timers.
 */
export async function pollOnce(ctx: PollContext): Promise<void> {
    const { deps, emit, previous, pids } = ctx;
    const cpuThresholdMs = ctx.cpuThresholdMs ?? CPU_DELTA_THRESHOLD_MS;
    const terminals = deps.getTerminals();
    if (terminals.length === 0) {
        // Nothing to watch — skip the `ps` entirely. This is the common case
        // for a window with no terminals open, and keeps the idle cost at zero.
        return;
    }

    // Resolve any pids we do not have yet, then take a single snapshot for
    // every terminal. One `ps` per tick regardless of terminal count is the
    // whole point of this source.
    const targets: Array<{ terminal: TerminalHandle; pid: number }> = [];
    for (const terminal of terminals) {
        let pid = pids.get(terminal);
        if (pid === undefined) {
            pid = await deps.resolvePid(terminal);
            if (pid === undefined) {
                continue;
            }
            pids.set(terminal, pid);
        }
        targets.push({ terminal, pid });
    }
    if (targets.length === 0) {
        return;
    }

    const index = buildChildIndex(parsePsOutput(await deps.runPs()));
    for (const { terminal, pid } of targets) {
        const curr = sampleShell(index, pid);
        const verdict = diffSamples(
            previous.get(terminal),
            curr,
            cpuThresholdMs
        );
        previous.set(terminal, curr);
        if (verdict.active) {
            emit({ terminal, reason: `proc: ${verdict.reason}` });
        }
    }
}
