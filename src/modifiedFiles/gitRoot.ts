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
 *
 * `log` is optional — when provided, every walked directory is recorded
 * so debugging "why isn't it finding .git" is possible without strace.
 */
export function detectGitRoot(
    startDir: string,
    log?: (msg: string) => void,
): string | null {
    if (!startDir) return null;
    let dir = path.resolve(startDir);
    const fsRoot = path.parse(dir).root;
    log?.(`[modifiedFiles] detectGitRoot start="${startDir}" resolved="${dir}" fsRoot="${fsRoot}"`);
    while (dir !== fsRoot) {
        const gitPath = path.join(dir, ".git");
        try {
            const stat = fs.statSync(gitPath);
            log?.(`[modifiedFiles]   hit ${gitPath} isDir=${stat.isDirectory()} isFile=${stat.isFile()}`);
            if (stat.isDirectory() || stat.isFile()) return dir;
        } catch (e) {
            log?.(`[modifiedFiles]   miss ${gitPath} (${(e as NodeJS.ErrnoException).code ?? "?"})`);
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null; // belt-and-suspenders against fsRoot miss
        dir = parent;
    }
    return null;
}