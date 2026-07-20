import { constants } from "node:fs";
import { execFile } from "node:child_process";
import {
    chmod,
    copyFile,
    mkdir,
    readdir,
    stat,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export interface CopyMissingResult {
    readonly copied: number;
    readonly skipped: number;
}

export type GitRunner = (
    args: readonly string[],
    cwd: string
) => Promise<string>;

const execFileAsync = promisify(execFile);

const defaultGitRunner: GitRunner = async (args, cwd) => {
    const { stdout } = await execFileAsync("git", [...args], {
        cwd,
        encoding: "utf8",
    });
    return stdout;
};

export async function copyMissingTree(
    sourceRoot: string,
    targetRoot: string
): Promise<CopyMissingResult> {
    const sourceInfo = await stat(sourceRoot);
    if (!sourceInfo.isDirectory()) {
        throw new Error(
            `Git hooks template is not a directory: ${sourceRoot}`
        );
    }

    let copied = 0;
    let skipped = 0;

    async function visit(
        sourceDir: string,
        targetDir: string
    ): Promise<void> {
        await mkdir(targetDir, { recursive: true });
        const entries = await readdir(sourceDir, { withFileTypes: true });
        for (const entry of entries) {
            const sourcePath = path.join(sourceDir, entry.name);
            const targetPath = path.join(targetDir, entry.name);
            if (entry.isDirectory()) {
                await visit(sourcePath, targetPath);
                continue;
            }
            if (!entry.isFile()) continue;

            try {
                await copyFile(
                    sourcePath,
                    targetPath,
                    constants.COPYFILE_EXCL
                );
                await chmod(targetPath, (await stat(sourcePath)).mode);
                copied += 1;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "EEXIST") {
                    skipped += 1;
                    continue;
                }
                throw error;
            }
        }
    }

    await visit(sourceRoot, targetRoot);
    return { copied, skipped };
}

export async function isGitRepository(
    repoRoot: string,
    runGit: GitRunner = defaultGitRunner
): Promise<boolean> {
    try {
        return (
            await runGit(
                ["rev-parse", "--is-inside-work-tree"],
                repoRoot
            )
        ).trim() === "true";
    } catch {
        return false;
    }
}

export async function readLocalHooksPath(
    repoRoot: string,
    runGit: GitRunner = defaultGitRunner
): Promise<string | null> {
    try {
        return (
            await runGit(
                ["config", "--local", "--get", "core.hooksPath"],
                repoRoot
            )
        ).trim();
    } catch (error) {
        if ((error as { code?: string | number }).code === 1) return null;
        throw error;
    }
}

export async function hasLocalHooksPath(
    repoRoot: string,
    runGit: GitRunner = defaultGitRunner
): Promise<boolean> {
    const hooksPath = await readLocalHooksPath(repoRoot, runGit);
    return hooksPath !== null && hooksPath.trim().length > 0;
}

export async function linkGitHooks(
    repoRoot: string,
    runGit: GitRunner = defaultGitRunner
): Promise<void> {
    await runGit(
        ["config", "--local", "core.hooksPath", ".githooks"],
        repoRoot
    );
}
