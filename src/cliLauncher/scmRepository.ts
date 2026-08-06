// CLI Change View 的 Git process boundary。
//
// 所有操作都限定在 selected path 自己的 `.git` marker，不允許 Git 沿 parent
// repository 往上找。參數直接交給 `execFile`，commit message 不經 shell。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hasOwnGitMarker } from "./repositoryDiscovery";
import { resolveRepositoryPath } from "./scmPath";
import { parseGitStatus, type GitChange } from "./scmStatus";

const execFileAsync = promisify(execFile);
const READ_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

export interface GitSCMRepository {
    isRepository(repoPath: string): Promise<boolean>;
    readChanges(repoPath: string): Promise<GitChange[]>;
    stage(repoPath: string, relativePaths: readonly string[]): Promise<void>;
    unstage(repoPath: string, relativePaths: readonly string[]): Promise<void>;
    discardWorktreeChanges(
        repoPath: string,
        relativePaths: readonly string[]
    ): Promise<void>;
    discardTrackedChanges(
        repoPath: string,
        relativePaths: readonly string[]
    ): Promise<void>;
    isTrackedInHead(repoPath: string, relativePath: string): Promise<boolean>;
    commitStaged(repoPath: string, message: string): Promise<void>;
    readHeadFile(repoPath: string, relativePath: string): Promise<string>;
    readIndexFile(repoPath: string, relativePath: string): Promise<string>;
}

async function assertRepository(repoPath: string): Promise<void> {
    if (!(await hasOwnGitMarker(repoPath))) {
        throw new Error(`Selected path is not a Git repository: ${repoPath}`);
    }
}

function describeProcessError(error: unknown): string {
    if (typeof error === "object" && error !== null && "stderr" in error) {
        const stderr = String(
            (error as { stderr?: unknown }).stderr ?? ""
        ).trim();
        if (stderr !== "") {
            return stderr;
        }
    }
    return error instanceof Error ? error.message : String(error);
}

async function runGit(
    repoPath: string,
    args: readonly string[],
    timeout: number
): Promise<string> {
    try {
        const { stdout } = await execFileAsync("git", [...args], {
            cwd: repoPath,
            encoding: "utf8",
            timeout,
            maxBuffer: GIT_MAX_BUFFER,
            env: {
                ...process.env,
                GIT_TERMINAL_PROMPT: "0",
                LC_ALL: "C",
            },
        });
        return stdout;
    } catch (error: unknown) {
        throw new Error(describeProcessError(error), { cause: error });
    }
}

function checkedPaths(
    repoPath: string,
    relativePaths: readonly string[]
): string[] {
    const unique = [...new Set(relativePaths)];
    if (unique.length === 0) {
        throw new Error("At least one change path is required.");
    }
    for (const relativePath of unique) {
        resolveRepositoryPath(repoPath, relativePath);
    }
    return unique;
}

function processExitCode(error: unknown): string | number | undefined {
    if (!(error instanceof Error) || !("cause" in error)) {
        return undefined;
    }
    const cause = error.cause;
    if (typeof cause !== "object" || cause === null || !("code" in cause)) {
        return undefined;
    }
    const code = (cause as { code?: unknown }).code;
    return typeof code === "number" || typeof code === "string"
        ? code
        : undefined;
}

async function hasHead(repoPath: string): Promise<boolean> {
    try {
        await runGit(
            repoPath,
            ["--no-optional-locks", "rev-parse", "--verify", "--quiet", "HEAD"],
            READ_TIMEOUT_MS
        );
        return true;
    } catch (error: unknown) {
        if (processExitCode(error) === 1) {
            return false;
        }
        throw error;
    }
}

export const gitSCMRepository: GitSCMRepository = {
    isRepository(repoPath) {
        return hasOwnGitMarker(repoPath);
    },

    async readChanges(repoPath) {
        await assertRepository(repoPath);
        const output = await runGit(
            repoPath,
            [
                "--no-optional-locks",
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
            ],
            READ_TIMEOUT_MS
        );
        return parseGitStatus(output);
    },

    async stage(repoPath, relativePaths) {
        await assertRepository(repoPath);
        const paths = checkedPaths(repoPath, relativePaths);
        await runGit(
            repoPath,
            ["add", "--all", "--", ...paths],
            WRITE_TIMEOUT_MS
        );
    },

    async unstage(repoPath, relativePaths) {
        await assertRepository(repoPath);
        const paths = checkedPaths(repoPath, relativePaths);
        if (await hasHead(repoPath)) {
            await runGit(
                repoPath,
                ["restore", "--staged", "--", ...paths],
                WRITE_TIMEOUT_MS
            );
            return;
        }
        await runGit(
            repoPath,
            ["rm", "--cached", "-r", "--ignore-unmatch", "--", ...paths],
            WRITE_TIMEOUT_MS
        );
    },

    async discardWorktreeChanges(repoPath, relativePaths) {
        await assertRepository(repoPath);
        const paths = checkedPaths(repoPath, relativePaths);
        await runGit(
            repoPath,
            ["restore", "--worktree", "--", ...paths],
            WRITE_TIMEOUT_MS
        );
    },

    async discardTrackedChanges(repoPath, relativePaths) {
        await assertRepository(repoPath);
        const paths = checkedPaths(repoPath, relativePaths);
        await runGit(
            repoPath,
            [
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                ...paths,
            ],
            WRITE_TIMEOUT_MS
        );
    },

    async isTrackedInHead(repoPath, relativePath) {
        await assertRepository(repoPath);
        resolveRepositoryPath(repoPath, relativePath);
        if (!(await hasHead(repoPath))) {
            return false;
        }
        const output = await runGit(
            repoPath,
            [
                "--no-optional-locks",
                "ls-tree",
                "-z",
                "--name-only",
                "HEAD",
                "--",
                relativePath,
            ],
            READ_TIMEOUT_MS
        );
        return output !== "";
    },

    async commitStaged(repoPath, message) {
        const trimmed = message.trim();
        if (trimmed === "") {
            throw new Error("A commit message is required.");
        }
        await assertRepository(repoPath);
        await runGit(repoPath, ["commit", "-m", trimmed], WRITE_TIMEOUT_MS);
    },

    async readHeadFile(repoPath, relativePath) {
        await assertRepository(repoPath);
        resolveRepositoryPath(repoPath, relativePath);
        return runGit(
            repoPath,
            [
                "--no-optional-locks",
                "show",
                "--no-ext-diff",
                "--textconv",
                `HEAD:${relativePath}`,
            ],
            READ_TIMEOUT_MS
        );
    },

    async readIndexFile(repoPath, relativePath) {
        await assertRepository(repoPath);
        resolveRepositoryPath(repoPath, relativePath);
        return runGit(
            repoPath,
            [
                "--no-optional-locks",
                "show",
                "--no-ext-diff",
                "--textconv",
                `:${relativePath}`,
            ],
            READ_TIMEOUT_MS
        );
    },
};
