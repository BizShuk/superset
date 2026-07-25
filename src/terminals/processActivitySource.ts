// Activity source `A`: process-tree polling.
//
// Detects "this terminal is doing something" by watching each shell's
// descendant processes instead of its output bytes. Costs one `ps` invocation
// per poll for *all* terminals combined, and nothing at all when no terminal
// is tracked. Contrast with the PTY path, which pays proportional to output
// volume on the extension-host main thread.
//
// This is the source that covers full-screen TUIs (`claude`, `codex`, `vim`,
// `htop`). Shell integration cannot see inside them — the execution stays open
// for the program's whole lifetime — but the process tree shows the foreground
// child burning CPU, which is exactly the "still working" signal we want.

import type { ActivityEvent, ActivitySource } from "./activitySource";
import type { TerminalHandle } from "./types";
import {
    buildChildIndex,
    diffSamples,
    parsePsOutput,
    sampleShell,
    type ShellSample,
} from "./processTreeSampler";

/**
 * Poll cadence. 1 Hz is fast enough that a background build finishing feels
 * immediate in the panel, and slow enough that the `ps` cost is irrelevant
 * (a full process-table scan is single-digit milliseconds and runs in a child
 * process, not on the extension-host thread).
 */
export const DEFAULT_POLL_INTERVAL_MS = 1000;

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
}

/**
 * One poll cycle. Exported for tests so a single deterministic cycle can be
 * driven without touching timers.
 */
export async function pollOnce(ctx: PollContext): Promise<void> {
    const { deps, emit, previous, pids } = ctx;
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
        const verdict = diffSamples(previous.get(terminal), curr);
        previous.set(terminal, curr);
        if (verdict.active) {
            emit({ terminal, reason: `proc: ${verdict.reason}` });
        }
    }
}
