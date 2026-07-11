import type { ModifiedFile, FileStatus } from "./types";

/**
 * Match git porcelain v1 format:
 *   XY <path>           for status (M/A/D/R/C/T/U/?/!/ )
 *   XY <old> -> <new>   for rename/copy (R/C)
 *
 * XY: index char (X) + worktree char (Y). Each may be space.
 */
const PORCELAIN_RE = /^([ MAD?!RC]{2})\s+(.+?)(?:\s+->\s+(.+))?$/;

export function parse(stdout: string): ModifiedFile[] {
    const out: ModifiedFile[] = [];
    for (const rawLine of stdout.split("\n")) {
        if (!rawLine) continue;
        const m = rawLine.match(PORCELAIN_RE);
        if (!m) {
            console.warn(
                `[modifiedFiles] unparseable git status line: ${JSON.stringify(rawLine)}`,
            );
            continue;
        }
        const [, xy, pathPart, arrowTarget] = m;
        const combined = combineStatus(xy[0]!, xy[1]!, pathPart, arrowTarget);
        if (combined) out.push(combined);
    }
    return out;
}

function combineStatus(
    x: string,
    y: string,
    path: string,
    arrowTarget: string | undefined,
): ModifiedFile | null {
    // Rename/copy: R anywhere in XY wins (porcelain emits "R ", " R", or "RM" etc.)
    if (x === "R" || y === "R") {
        return { path: arrowTarget ?? path, status: "R", oldPath: path };
    }
    // Untracked
    if (x === "?" && y === "?") return { path, status: "?" };
    // Worktree (Y) takes priority over staged (X) — unstaged is more visible to user
    const pri = y !== " " ? y : x;
    const status: FileStatus | null =
        pri === "M" ? "M" :
        pri === "A" ? "A" :
        pri === "D" ? "D" :
        pri === "?" ? "?" :
        pri === " " ? null :
        // Other XY (T=type-change, U=unmerged) — render as M with note in tooltip
        "M";
    return status ? { path, status } : null;
}