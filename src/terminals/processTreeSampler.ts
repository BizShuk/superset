// Pure process-tree analysis for the `A` activity source.
//
// No `vscode` and no `child_process` import — this module only parses the
// text a `ps` invocation produced and derives an activity verdict from two
// consecutive samples. The I/O lives in `processActivitySource.ts` so the
// interesting logic (cumulative-CPU deltas, descendant-set changes, exit
// handling) is unit-testable without spawning anything.
//
// Why cumulative CPU time and not `%cpu`: on macOS `%cpu` is a decaying
// average since process start, so a burst of work barely moves it and a
// long-idle process keeps reporting a stale non-zero value. `ps -o time=`
// is monotonic per process, so a delta between two samples is exactly
// "CPU consumed in that window" — the signal we actually want.

/** One row of `ps -axo pid=,ppid=,time=,comm=`. */
export interface ProcRow {
    readonly pid: number;
    readonly ppid: number;
    /** Cumulative CPU time consumed by this process, in milliseconds. */
    readonly cpuMs: number;
    readonly comm: string;
}

/**
 * Parse a `ps -o time=` field into milliseconds.
 *
 * Handles every layout the two supported platforms emit:
 * - macOS  `0:00.00`, `22:47.51`, `1234:56.78` (minutes may exceed 60)
 * - Linux  `00:00:00`, `2-03:04:05` (leading day count)
 *
 * Returns 0 for anything unparseable — an unreadable row must not be able
 * to fabricate a huge delta and spuriously flag a terminal as active.
 */
export function parseCpuTime(raw: string): number {
    const text = raw.trim();
    if (text === "") {
        return 0;
    }
    let days = 0;
    let rest = text;
    const dash = text.indexOf("-");
    if (dash >= 0) {
        days = Number(text.slice(0, dash));
        rest = text.slice(dash + 1);
        if (!Number.isFinite(days)) {
            return 0;
        }
    }
    const parts = rest.split(":");
    if (parts.length > 3) {
        return 0;
    }
    // Right-align: the last field is always seconds (possibly fractional),
    // the one before it minutes, the one before that hours.
    const seconds = Number(parts[parts.length - 1]);
    const minutes = parts.length >= 2 ? Number(parts[parts.length - 2]) : 0;
    const hours = parts.length >= 3 ? Number(parts[parts.length - 3]) : 0;
    if (
        !Number.isFinite(seconds) ||
        !Number.isFinite(minutes) ||
        !Number.isFinite(hours)
    ) {
        return 0;
    }
    const total =
        days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
    return Math.round(total * 1000);
}

/**
 * Parse the whole `ps -axo pid=,ppid=,time=,comm=` payload.
 *
 * `comm=` emits the full executable path on macOS and may contain spaces,
 * so the first three whitespace-delimited fields are taken positionally and
 * everything after them is the command. Malformed lines are skipped rather
 * than throwing — `ps` output races with process exit and a torn line must
 * not take the whole poll down.
 */
export function parsePsOutput(text: string): ProcRow[] {
    const rows: ProcRow[] = [];
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") {
            continue;
        }
        const m = /^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(trimmed);
        if (!m) {
            continue;
        }
        rows.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            cpuMs: parseCpuTime(m[3]),
            comm: m[4] ?? "",
        });
    }
    return rows;
}

/** `ppid -> children` index, built once per poll and shared by every terminal. */
export type ChildIndex = ReadonlyMap<number, readonly ProcRow[]>;

export function buildChildIndex(rows: readonly ProcRow[]): ChildIndex {
    const index = new Map<number, ProcRow[]>();
    for (const row of rows) {
        const bucket = index.get(row.ppid);
        if (bucket) {
            bucket.push(row);
        } else {
            index.set(row.ppid, [row]);
        }
    }
    return index;
}

/** Per-shell snapshot derived from one `ps` sample. */
export interface ShellSample {
    /** Descendant pids, ascending, excluding the shell itself. */
    readonly descendantPids: readonly number[];
    /** Summed cumulative CPU time of every descendant, in milliseconds. */
    readonly cpuMs: number;
}

/**
 * Collect every descendant of `shellPid`.
 *
 * The shell itself is excluded on purpose: an interactive shell sitting at
 * its prompt still accrues a little CPU (prompt repaint, `precmd` hooks),
 * and counting it would make every idle terminal look busy. What we want to
 * detect is a *foreground program* — `claude`, `vim`, `npm test` — which is
 * always a child.
 *
 * `seen` guards against a pid cycle. That should be impossible in a real
 * process table, but `ps` output is sampled non-atomically and pid reuse
 * during the scan could in principle produce one; an infinite loop inside a
 * 1 Hz poll would hang the extension host, which is the exact failure class
 * this whole source exists to avoid.
 */
export function sampleShell(index: ChildIndex, shellPid: number): ShellSample {
    const pids: number[] = [];
    let cpuMs = 0;
    const seen = new Set<number>([shellPid]);
    const queue: number[] = [shellPid];
    while (queue.length > 0) {
        const current = queue.pop() as number;
        for (const child of index.get(current) ?? []) {
            if (seen.has(child.pid)) {
                continue;
            }
            seen.add(child.pid);
            pids.push(child.pid);
            cpuMs += child.cpuMs;
            queue.push(child.pid);
        }
    }
    pids.sort((a, b) => a - b);
    return { descendantPids: pids, cpuMs };
}

export interface ActivityVerdict {
    readonly active: boolean;
    /** Human-readable justification for the diagnostic channel. */
    readonly reason: string;
}

/**
 * Minimum CPU-time delta that counts as activity.
 *
 * `ps` reports CPU time at centisecond resolution, so 10ms is the smallest
 * observable non-zero delta. Anything lower would be indistinguishable from
 * rounding noise.
 */
export const CPU_DELTA_THRESHOLD_MS = 10;

/**
 * Compare two consecutive samples of the same shell.
 *
 * Rules, in order:
 * 1. No descendants now  -> idle. The shell is at its prompt; whatever ran
 *    before has exited and (if it mattered) already fired on its set change.
 * 2. No previous sample  -> idle. The first poll only establishes a baseline;
 *    firing here would flag every terminal the moment the extension loads.
 * 3. Descendant set changed -> active. A program started or exited.
 * 4. CPU delta over threshold -> active. A long-lived TUI is doing work.
 *
 * The CPU delta is clamped at zero: when a descendant exits its cumulative
 * time leaves the sum, which would otherwise read as a large negative.
 * Rule 3 already covers that transition.
 */
export function diffSamples(
    prev: ShellSample | undefined,
    curr: ShellSample,
    cpuThresholdMs: number = CPU_DELTA_THRESHOLD_MS
): ActivityVerdict {
    if (curr.descendantPids.length === 0) {
        return { active: false, reason: "no foreground process" };
    }
    if (!prev) {
        return { active: false, reason: "baseline sample" };
    }
    if (!samePids(prev.descendantPids, curr.descendantPids)) {
        return {
            active: true,
            reason: `process set changed (${prev.descendantPids.length}->${curr.descendantPids.length})`,
        };
    }
    const delta = Math.max(0, curr.cpuMs - prev.cpuMs);
    if (delta >= cpuThresholdMs) {
        return { active: true, reason: `cpu +${delta}ms` };
    }
    return { active: false, reason: `cpu +${delta}ms below threshold` };
}

function samePids(a: readonly number[], b: readonly number[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}
