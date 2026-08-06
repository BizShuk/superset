import { execFile } from "node:child_process";
import {
    mkdtemp,
    mkdir,
    readFile,
    rm,
    unlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitSCMRepository } from "../src/cliLauncher/scmRepository";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", [...args], {
        cwd,
        encoding: "utf8",
    });
    return stdout;
}

describe("gitSCMRepository", () => {
    let sandbox = "";
    let repository = "";

    beforeEach(async () => {
        sandbox = await mkdtemp(join(tmpdir(), "superset-scm-"));
        repository = join(sandbox, "repository");
        await mkdir(repository);
        await git(repository, ["init"]);
        await git(repository, ["config", "user.name", "Superset Test"]);
        await git(repository, [
            "config",
            "user.email",
            "superset-test@example.invalid",
        ]);
        await writeFile(join(repository, "modified.txt"), "before\n");
        await writeFile(join(repository, "deleted.txt"), "delete me\n");
        await git(repository, ["add", "--all"]);
        await git(repository, ["commit", "-m", "baseline"]);
    });

    afterEach(async () => {
        await rm(sandbox, { recursive: true, force: true });
    });

    it("reads modified, newly added, and deleted working-tree changes", async () => {
        await writeFile(join(repository, "modified.txt"), "after\n");
        await writeFile(join(repository, "added.txt"), "new\n");
        await unlink(join(repository, "deleted.txt"));

        const changes = await gitSCMRepository.readChanges(repository);
        expect(
            new Map(
                changes.map((change) => [
                    `${change.group}:${change.path}`,
                    change.marker,
                ])
            )
        ).toEqual(
            new Map([
                ["untracked:added.txt", "A"],
                ["unstaged:deleted.txt", "D"],
                ["unstaged:modified.txt", "U"],
            ])
        );
    });

    it("returns separate staged and unstaged entries for one mixed path", async () => {
        await writeFile(join(repository, "modified.txt"), "staged\n");
        await gitSCMRepository.stage(repository, ["modified.txt"]);
        await writeFile(join(repository, "modified.txt"), "worktree\n");

        await expect(gitSCMRepository.readChanges(repository)).resolves.toEqual([
            {
                group: "staged",
                marker: "U",
                path: "modified.txt",
                indexStatus: "M",
                workTreeStatus: "M",
            },
            {
                group: "unstaged",
                marker: "U",
                path: "modified.txt",
                indexStatus: "M",
                workTreeStatus: "M",
            },
        ]);
    });

    it("reads the HEAD side used by the Diff Editor", async () => {
        await expect(
            gitSCMRepository.readHeadFile(repository, "modified.txt")
        ).resolves.toBe("before\n");
    });

    it("stages and unstages an explicit set of paths", async () => {
        await writeFile(join(repository, "modified.txt"), "after\n");
        await writeFile(join(repository, "added.txt"), "new\n");
        await unlink(join(repository, "deleted.txt"));

        await gitSCMRepository.stage(repository, [
            "modified.txt",
            "added.txt",
            "deleted.txt",
        ]);
        await expect(
            git(repository, ["diff", "--cached", "--name-only"])
        ).resolves.toBe("added.txt\ndeleted.txt\nmodified.txt\n");

        await gitSCMRepository.unstage(repository, [
            "modified.txt",
            "added.txt",
            "deleted.txt",
        ]);
        await expect(
            git(repository, ["diff", "--cached", "--name-only"])
        ).resolves.toBe("");
        await expect(git(repository, ["status", "--porcelain"])).resolves.toBe(
            " D deleted.txt\n M modified.txt\n?? added.txt\n"
        );
    });

    it("unstages paths in a repository without a first commit", async () => {
        const unborn = join(sandbox, "unborn");
        await mkdir(unborn);
        await git(unborn, ["init"]);
        await writeFile(join(unborn, "new.txt"), "new\n");

        await gitSCMRepository.stage(unborn, ["new.txt"]);
        await gitSCMRepository.unstage(unborn, ["new.txt"]);

        await expect(
            git(unborn, ["diff", "--cached", "--name-only"])
        ).resolves.toBe("");
        await expect(git(unborn, ["status", "--porcelain"])).resolves.toBe(
            "?? new.txt\n"
        );
    });

    it("reads index content independently from HEAD and the worktree", async () => {
        await writeFile(join(repository, "modified.txt"), "staged\n");
        await gitSCMRepository.stage(repository, ["modified.txt"]);
        await writeFile(join(repository, "modified.txt"), "worktree\n");

        await expect(
            gitSCMRepository.readIndexFile(repository, "modified.txt")
        ).resolves.toBe("staged\n");
        await expect(
            gitSCMRepository.readHeadFile(repository, "modified.txt")
        ).resolves.toBe("before\n");
    });

    it("discards worktree changes back to the index without losing staged changes", async () => {
        await writeFile(join(repository, "modified.txt"), "staged\n");
        await gitSCMRepository.stage(repository, ["modified.txt"]);
        await writeFile(join(repository, "modified.txt"), "worktree\n");

        await gitSCMRepository.discardWorktreeChanges(repository, [
            "modified.txt",
        ]);

        await expect(
            readFile(join(repository, "modified.txt"), "utf8")
        ).resolves.toBe("staged\n");
        await expect(
            git(repository, ["diff", "--cached", "--name-only"])
        ).resolves.toBe("modified.txt\n");
    });

    it("discards tracked changes from both the index and worktree back to HEAD", async () => {
        await writeFile(join(repository, "modified.txt"), "staged\n");
        await gitSCMRepository.stage(repository, ["modified.txt"]);
        await writeFile(join(repository, "modified.txt"), "worktree\n");

        await gitSCMRepository.discardTrackedChanges(repository, [
            "modified.txt",
        ]);

        await expect(
            readFile(join(repository, "modified.txt"), "utf8")
        ).resolves.toBe("before\n");
        await expect(git(repository, ["status", "--porcelain"])).resolves.toBe(
            ""
        );
    });

    it("discards both paths of a staged rename back to HEAD", async () => {
        await git(repository, ["mv", "modified.txt", "renamed.txt"]);

        await gitSCMRepository.discardTrackedChanges(repository, [
            "renamed.txt",
            "modified.txt",
        ]);

        await expect(
            readFile(join(repository, "modified.txt"), "utf8")
        ).resolves.toBe("before\n");
        await expect(
            readFile(join(repository, "renamed.txt"), "utf8")
        ).rejects.toThrow();
        await expect(git(repository, ["status", "--porcelain"])).resolves.toBe(
            ""
        );
    });

    it("identifies whether a path exists in HEAD", async () => {
        await writeFile(join(repository, "added.txt"), "new\n");

        await expect(
            gitSCMRepository.isTrackedInHead(repository, "modified.txt")
        ).resolves.toBe(true);
        await expect(
            gitSCMRepository.isTrackedInHead(repository, "added.txt")
        ).resolves.toBe(false);
    });

    it("does not let Git walk up to a parent repository", async () => {
        const plainDirectory = join(repository, "plain-directory");
        await mkdir(plainDirectory);

        await expect(
            gitSCMRepository.isRepository(plainDirectory)
        ).resolves.toBe(false);
        await expect(
            gitSCMRepository.readChanges(plainDirectory)
        ).rejects.toThrow("Git repository");
        await expect(
            gitSCMRepository.stage(plainDirectory, ["file.txt"])
        ).rejects.toThrow("Git repository");
    });
});
