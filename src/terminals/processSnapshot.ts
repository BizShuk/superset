// I/O adapter for activity source `A`.
//
// Isolated from `processTreeSampler.ts` (pure parsing) and
// `processActivitySource.ts` (pure polling policy) so the only thing that
// touches `child_process` is this file, and tests never spawn anything.

import { execFile } from "child_process";
import * as vscode from "vscode";
import type { TerminalHandle } from "./types";

/**
 * `ps` fields, in the order `parsePsOutput` expects: pid, ppid, cumulative
 * CPU time, command. The trailing `=` on each suppresses the header line.
 * This flag set is accepted by both macOS and Linux `ps`.
 */
const PS_ARGS = ["-axo", "pid=,ppid=,time=,comm="];

/**
 * Hard ceiling on one `ps` run. The poll loop already serialises ticks, so a
 * hung `ps` would stall detection indefinitely without this. 5s is far beyond
 * a normal run (single-digit ms) and only trips on a genuinely wedged system.
 */
const PS_TIMEOUT_MS = 5000;

/**
 * Output cap. A process table large enough to exceed this is pathological,
 * but an uncapped buffer here would be an unbounded allocation driven by
 * machine state rather than by us.
 */
const PS_MAX_BUFFER = 8 * 1024 * 1024;

/** Runs one process-table snapshot. Rejects if `ps` fails or times out. */
export function runPsSnapshot(): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            "ps",
            PS_ARGS,
            { timeout: PS_TIMEOUT_MS, maxBuffer: PS_MAX_BUFFER },
            (err, stdout) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(stdout);
            }
        );
    });
}

/**
 * Resolve a terminal's shell pid.
 *
 * `vscode.Terminal.processId` is a `Thenable<number | undefined>` that
 * resolves to undefined for pseudoterminal-backed terminals — they have no
 * OS-level shell process of their own, so the process-tree source skips them.
 * Any rejection is swallowed into undefined for the same reason: a terminal we
 * cannot identify is simply not watched by this source.
 */
export async function resolveTerminalPid(
    terminal: TerminalHandle
): Promise<number | undefined> {
    const candidate = (terminal as unknown as vscode.Terminal).processId;
    if (candidate === undefined || candidate === null) {
        return undefined;
    }
    try {
        const pid = await candidate;
        return typeof pid === "number" && pid > 0 ? pid : undefined;
    } catch {
        return undefined;
    }
}
