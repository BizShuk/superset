import * as fs from "fs";
import * as path from "path";

/**
 * Walk up from `startDir` looking for a `.git` entry (directory or file —
 * the file case covers gitlinks/submodules/worktrees). Returns the directory
 * containing `.git`, or `null` if we reach the filesystem root without
 * finding one.
 *
 * Why filesystem walk instead of `git rev-parse --show-toplevel`:
 * - Doesn't depend on the git binary being installed or on PATH
 * - Doesn't surprise the user when git finds a parent repo they didn't
 *   intend (e.g., a stale `.git` file left in `~/projects/` or a parent
 *   repo they didn't know about). The panel now reports "Not a git
 *   repository" instead of silently switching context.
 * - Pure function with no I/O beyond `statSync`; trivial to unit-test.
 */
export function detectGitRoot(startDir: string): string | null {
    if (!startDir) return null;
    let dir = path.resolve(startDir);
    const fsRoot = path.parse(dir).root;
    while (dir !== fsRoot) {
        try {
            const stat = fs.statSync(path.join(dir, ".git"));
            // .git can be a directory (regular repo) or a file (submodule/worktree pointer)
            if (stat.isDirectory() || stat.isFile()) return dir;
        } catch {
            // .git doesn't exist here — walk up
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null; // belt-and-suspenders against fsRoot miss
        dir = parent;
    }
    return null;
}