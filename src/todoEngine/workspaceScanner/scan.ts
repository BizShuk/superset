// Pure workspace scanner — used by `src/todo/`
// (depth-1 panel). Walks a directory tree and returns the absolute
// paths of every directory that directly contains an exact
// case-sensitive `README.todo` file.
//
// Originally lived inside the projects TODO store as
// private helpers `collectTodoFiles` / `walkTodoFiles`. Lifted here so
// multiple panels (workspace scan at configurable depth, depth-1 panel,
// future scanners) share one implementation without inverting the
// layer hierarchy (`src/todo/` is downstream of `src/todoEngine/`).
//
// **Pure**: no `vscode` import, no listeners, no EventEmitter. Easy to
// unit-test with a tmp dir; the only fs APIs touched are `readdir` and
// `stat` from `node:fs/promises`.

import { readdir, stat } from "fs/promises";
import type { Dirent } from "fs";
import * as path from "path";

/**
 * Directory name blacklist — the scanner skips these directories
 * entirely. Expected to be dependency caches, build outputs, or test
 * coverage directories that bloat or clearly aren't sub-projects.
 *
 * User-defined `node_modules/`, `out/`, `dist/` etc. are auto-excluded
 * here; no per-panel setting is exposed.
 */
export const TODO_SCAN_SKIP_DIRS: ReadonlySet<string> = new Set([
    "node_modules",
    "out",
    "dist",
    "build",
    "coverage",
]);

/**
 * Walk a directory tree from `root` and collect every directory
 * containing a case-exact `README.todo` file.
 *
 * @param root          Absolute path to scan from.
 * @param maxDepth      Maximum recursion depth (root = 0). Traversal
 *                      stops after checking the directory at this depth;
 *                      its children are not visited.
 * @param includeRoot   Whether the root directory itself is eligible
 *                      to be a match. `false` excludes it from matches
 *                      while still recursing into its children; `true`
 *                      treats the root like any other candidate.
 * @returns             Absolute directory paths containing the file.
 *                      Order is unspecified (the set is populated in
 *                      recursion order).
 *
 * Behavior contract:
 *
 * - Only the exact case-sensitive filename `README.todo` matches. On
 *   macOS APFS (case-insensitive) we enumerate entries first and
 *   compare literally so `readme.todo` does not collide with
 *   `README.todo`.
 * - A directory containing a match is added to the result, but
 *   recursion continues into its children. This preserves nested
 *   sub-project discovery in monorepos — without it, a hit at `a/`
 *   would shadow `a/b/` and `a/b/c/`.
 * - Any directory whose name starts with `.` is skipped entirely,
 *   including its subtree (covers `.git`, `.vscode`, `.idea`, …).
 * - `TODO_SCAN_SKIP_DIRS` directories are skipped entirely with their
 *   subtrees (`node_modules`, `out`, `dist`, `build`, `coverage`).
 * - Unreadable directories are silently skipped — no exceptions.
 * - Symlink loops or broken symlinks encountered via `stat` failures
 *   are silently skipped.
 */
export async function scanWorkspaceTodoDirs(
    root: string,
    maxDepth: number,
    includeRoot: boolean,
): Promise<string[]> {
    const out: string[] = [];
    await walkTodoFiles(root, 0, maxDepth, includeRoot ? 0 : 1, out);
    return out;
}

/**
 * Recursion worker — entry point of `scanWorkspaceTodoDirs`.
 *
 * 1. If `depth >= minimumMatchDepth`, check whether `current` directly
 *    contains `README.todo` (case-exact); if yes, append `current` to
 *    `out` but DO NOT return — nested sub-projects remain visible.
 * 2. If `depth >= maxDepth`, return (no further recursion).
 * 3. Otherwise, recurse into every non-skipped child directory.
 */
async function walkTodoFiles(
    current: string,
    depth: number,
    maxDepth: number,
    minimumMatchDepth: number,
    out: string[],
): Promise<void> {
    let childEntries: Dirent[];
    try {
        childEntries = await readdir(current, { withFileTypes: true });
    } catch {
        return;
    }

    if (
        depth >= minimumMatchDepth &&
        childEntries.some((entry) => entry.name === "README.todo")
    ) {
        try {
            const todoStat = await stat(path.join(current, "README.todo"));
            if (todoStat.isFile()) {
                out.push(current);
                // 不 return — 繼續遞迴進子孫層,讓巢狀 sub-project 也收
            }
        } catch {
            // 同名 entry 但 stat 失敗(權限/symlink loop),跳過
        }
    }

    if (depth >= maxDepth) return;

    for (const entry of childEntries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        if (TODO_SCAN_SKIP_DIRS.has(entry.name)) continue;

        await walkTodoFiles(
            path.join(current, entry.name),
            depth + 1,
            maxDepth,
            minimumMatchDepth,
            out,
        );
    }
}