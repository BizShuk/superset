import { describe, it, expect } from "vitest";
import {
    CPU_DELTA_THRESHOLD_MS,
    buildChildIndex,
    diffSamples,
    parseCpuTime,
    parsePsOutput,
    sampleShell,
    type ShellSample,
} from "../src/terminals/processTreeSampler";

describe("parseCpuTime", () => {
    it("parses the macOS MM:SS.ss form", () => {
        expect(parseCpuTime("0:00.00")).toBe(0);
        expect(parseCpuTime("0:01.50")).toBe(1500);
        expect(parseCpuTime("22:47.51")).toBe(22 * 60_000 + 47_510);
    });

    it("parses minute counts beyond 60 (macOS does not roll over to hours)", () => {
        expect(parseCpuTime("1234:56.78")).toBe(1234 * 60_000 + 56_780);
    });

    it("parses the Linux HH:MM:SS form", () => {
        expect(parseCpuTime("01:02:03")).toBe(
            3_600_000 + 2 * 60_000 + 3_000
        );
    });

    it("parses the Linux DD-HH:MM:SS form", () => {
        expect(parseCpuTime("2-03:04:05")).toBe(
            2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000
        );
    });

    it("tolerates surrounding whitespace", () => {
        expect(parseCpuTime("  0:02.00  ")).toBe(2000);
    });

    it("returns 0 for unparseable input rather than NaN", () => {
        // A NaN here would poison the CPU sum and make every delta comparison
        // false, silently disabling detection for that terminal.
        for (const bad of ["", "   ", "abc", "1:2:3:4", "x-01:00", "1:xx"]) {
            expect(parseCpuTime(bad)).toBe(0);
        }
    });
});

describe("parsePsOutput", () => {
    it("parses pid, ppid, cpu time and command", () => {
        const rows = parsePsOutput(
            [
                "    1     0  22:47.51 /sbin/launchd",
                "  531     1   9:06.05 /usr/libexec/logd",
            ].join("\n")
        );
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            pid: 1,
            ppid: 0,
            cpuMs: 22 * 60_000 + 47_510,
            comm: "/sbin/launchd",
        });
        expect(rows[1].pid).toBe(531);
        expect(rows[1].ppid).toBe(1);
    });

    it("keeps spaces inside the command field", () => {
        const rows = parsePsOutput("100 1 0:01.00 /Applications/My App.app/Contents/MacOS/My App");
        expect(rows[0].comm).toBe(
            "/Applications/My App.app/Contents/MacOS/My App"
        );
    });

    it("skips blank and malformed lines instead of throwing", () => {
        // `ps` output races with process exit; a torn line must not take the
        // whole poll down.
        const rows = parsePsOutput(
            ["", "   ", "garbage line", "100 1 0:01.00 node", "not a row"].join(
                "\n"
            )
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].pid).toBe(100);
    });

    it("returns an empty array for empty input", () => {
        expect(parsePsOutput("")).toEqual([]);
    });
});

/** Build a child index from compact `[pid, ppid, cpuMs]` tuples. */
function indexOf(rows: Array<[number, number, number]>) {
    return buildChildIndex(
        rows.map(([pid, ppid, cpuMs]) => ({
            pid,
            ppid,
            cpuMs,
            comm: `p${pid}`,
        }))
    );
}

describe("sampleShell", () => {
    it("returns no descendants for a shell sitting at its prompt", () => {
        const index = indexOf([[500, 1, 1000]]);
        expect(sampleShell(index, 500)).toEqual({
            descendantPids: [],
            cpuMs: 0,
        });
    });

    it("excludes the shell's own CPU time", () => {
        // An interactive shell accrues CPU on every prompt repaint. Counting
        // it would make every idle terminal look busy.
        const index = indexOf([
            [500, 1, 999_000],
            [600, 500, 250],
        ]);
        expect(sampleShell(index, 500).cpuMs).toBe(250);
    });

    it("collects grandchildren, not just direct children", () => {
        const index = indexOf([
            [500, 1, 10],
            [600, 500, 100],
            [700, 600, 200],
            [800, 700, 300],
        ]);
        const sample = sampleShell(index, 500);
        expect(sample.descendantPids).toEqual([600, 700, 800]);
        expect(sample.cpuMs).toBe(600);
    });

    it("returns descendants in ascending pid order regardless of ps order", () => {
        // Ordering is load-bearing: diffSamples compares the pid lists
        // positionally, so an unstable order would fake a set change on
        // every poll and mark every terminal unseen forever.
        const index = indexOf([
            [500, 1, 0],
            [900, 500, 0],
            [600, 500, 0],
            [700, 900, 0],
        ]);
        expect(sampleShell(index, 500).descendantPids).toEqual([600, 700, 900]);
    });

    it("ignores processes belonging to another shell", () => {
        const index = indexOf([
            [500, 1, 0],
            [501, 1, 0],
            [600, 500, 100],
            [601, 501, 900],
        ]);
        expect(sampleShell(index, 500)).toEqual({
            descendantPids: [600],
            cpuMs: 100,
        });
    });

    it("terminates on a pid cycle", () => {
        // Non-atomic `ps` sampling plus pid reuse could in principle produce
        // one. An infinite loop inside a 1Hz poll would hang the extension
        // host — the exact failure this source exists to avoid.
        const index = indexOf([
            [500, 1, 0],
            [600, 500, 10],
            [700, 600, 20],
            [500, 700, 30],
        ]);
        const sample = sampleShell(index, 500);
        expect(sample.descendantPids).toEqual([600, 700]);
    });
});

const sample = (pids: number[], cpuMs: number): ShellSample => ({
    descendantPids: pids,
    cpuMs,
});

describe("diffSamples", () => {
    it("is idle when the shell has no foreground process", () => {
        const verdict = diffSamples(sample([600], 100), sample([], 0));
        expect(verdict.active).toBe(false);
        expect(verdict.reason).toContain("no foreground");
    });

    it("is idle on the first sample even when a process is running", () => {
        // The baseline poll must not flag every terminal the moment the
        // extension activates.
        const verdict = diffSamples(undefined, sample([600], 5000));
        expect(verdict.active).toBe(false);
        expect(verdict.reason).toContain("baseline");
    });

    it("is active when a new process appears", () => {
        const verdict = diffSamples(sample([600], 100), sample([600, 700], 100));
        expect(verdict.active).toBe(true);
        expect(verdict.reason).toContain("process set changed");
    });

    it("is active when a process exits while others remain", () => {
        const verdict = diffSamples(
            sample([600, 700], 500),
            sample([600], 100)
        );
        expect(verdict.active).toBe(true);
    });

    it("is active when CPU time advances past the threshold", () => {
        const verdict = diffSamples(
            sample([600], 1000),
            sample([600], 1000 + CPU_DELTA_THRESHOLD_MS)
        );
        expect(verdict.active).toBe(true);
        expect(verdict.reason).toContain("cpu +");
    });

    it("is idle when CPU time barely moves", () => {
        // A TUI parked waiting for input still gets scheduled occasionally.
        const verdict = diffSamples(sample([600], 1000), sample([600], 1000));
        expect(verdict.active).toBe(false);
    });

    it("is idle just below the threshold", () => {
        const verdict = diffSamples(
            sample([600], 1000),
            sample([600], 1000 + CPU_DELTA_THRESHOLD_MS - 1)
        );
        expect(verdict.active).toBe(false);
    });

    it("honours a custom threshold", () => {
        const curr = sample([600], 1500);
        expect(diffSamples(sample([600], 1000), curr, 400).active).toBe(true);
        expect(diffSamples(sample([600], 1000), curr, 600).active).toBe(false);
    });

    it("does not report activity from a negative CPU delta alone", () => {
        // Same pid list but a lower sum should be impossible; if it happens,
        // clamping must not let it read as a huge positive delta.
        const verdict = diffSamples(sample([600], 5000), sample([600], 10));
        expect(verdict.active).toBe(false);
    });
});
