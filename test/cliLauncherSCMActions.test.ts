import { describe, expect, it, vi } from "vitest";
import { SCMActionService } from "../src/cliLauncher/scmActions";
import type { GitSCMRepository } from "../src/cliLauncher/scmRepository";
import type {
    GitChange,
    GitChangeGroup,
    GitChangeMarker,
} from "../src/cliLauncher/scmStatus";

function change(
    group: GitChangeGroup,
    marker: GitChangeMarker,
    path: string,
    originalPath?: string
): GitChange {
    return {
        group,
        marker,
        path,
        ...(originalPath ? { originalPath } : {}),
        indexStatus: group === "staged" ? "M" : " ",
        workTreeStatus: group === "staged" ? " " : "M",
    };
}

function repositoryMock(): GitSCMRepository {
    return {
        isRepository: vi.fn(async () => true),
        readChanges: vi.fn(async () => []),
        stage: vi.fn(async () => undefined),
        unstage: vi.fn(async () => undefined),
        discardWorktreeChanges: vi.fn(async () => undefined),
        discardTrackedChanges: vi.fn(async () => undefined),
        isTrackedInHead: vi.fn(async () => true),
        readHeadFile: vi.fn(async () => ""),
        readIndexFile: vi.fn(async () => ""),
    };
}

describe("SCMActionService", () => {
    it.each(["unstaged", "untracked"] as const)(
        "stages every path in one %s category action",
        async (group) => {
            const repository = repositoryMock();
            const actions = new SCMActionService(repository, vi.fn());

            await actions.stage("/repo", [
                change(group, group === "untracked" ? "A" : "U", "a.txt"),
                change(group, "D", "renamed.txt", "old.txt"),
            ]);

            expect(repository.stage).toHaveBeenCalledWith("/repo", [
                "a.txt",
                "renamed.txt",
                "old.txt",
            ]);
        }
    );

    it("unstages every path in a staged category action", async () => {
        const repository = repositoryMock();
        const actions = new SCMActionService(repository, vi.fn());

        await actions.unstage("/repo", [
            change("staged", "U", "new.txt", "old.txt"),
        ]);

        expect(repository.unstage).toHaveBeenCalledWith("/repo", [
            "new.txt",
            "old.txt",
        ]);
    });

    it("discards ordinary unstaged changes back to the index", async () => {
        const repository = repositoryMock();
        const actions = new SCMActionService(repository, vi.fn());

        await actions.discard("/repo", [
            change("unstaged", "U", "modified.txt"),
            change("unstaged", "D", "deleted.txt"),
        ]);

        expect(repository.discardWorktreeChanges).toHaveBeenCalledWith(
            "/repo",
            ["modified.txt", "deleted.txt"]
        );
        expect(repository.discardTrackedChanges).not.toHaveBeenCalled();
    });

    it("discards conflicts from both the index and worktree", async () => {
        const repository = repositoryMock();
        const actions = new SCMActionService(repository, vi.fn());

        await actions.discard("/repo", [
            change("unstaged", "!", "conflict.txt"),
        ]);

        expect(repository.discardTrackedChanges).toHaveBeenCalledWith(
            "/repo",
            ["conflict.txt"]
        );
        expect(repository.discardWorktreeChanges).not.toHaveBeenCalled();
    });

    it("discards staged tracked changes from both the index and worktree", async () => {
        const repository = repositoryMock();
        const actions = new SCMActionService(repository, vi.fn());

        await actions.discard("/repo", [
            change("staged", "U", "modified.txt"),
        ]);

        expect(repository.discardTrackedChanges).toHaveBeenCalledWith(
            "/repo",
            ["modified.txt"]
        );
    });

    it("unstages and trashes newly staged files", async () => {
        const repository = repositoryMock();
        vi.mocked(repository.isTrackedInHead).mockResolvedValue(false);
        const trash = vi.fn(async () => undefined);
        const actions = new SCMActionService(repository, trash);

        await actions.discard("/repo", [
            change("staged", "A", "new folder/new.txt"),
        ]);

        expect(repository.unstage).toHaveBeenCalledWith("/repo", [
            "new folder/new.txt",
        ]);
        expect(trash).toHaveBeenCalledWith("/repo/new folder/new.txt");
        expect(repository.discardTrackedChanges).not.toHaveBeenCalled();
    });

    it("trashes untracked files without invoking Git restore", async () => {
        const repository = repositoryMock();
        const trash = vi.fn(async () => undefined);
        const actions = new SCMActionService(repository, trash);

        await actions.discard("/repo", [
            change("untracked", "A", "new.txt"),
        ]);

        expect(trash).toHaveBeenCalledWith("/repo/new.txt");
        expect(repository.discardWorktreeChanges).not.toHaveBeenCalled();
        expect(repository.discardTrackedChanges).not.toHaveBeenCalled();
    });

    it("rejects actions that do not match the rendered category", async () => {
        const repository = repositoryMock();
        const actions = new SCMActionService(repository, vi.fn());

        await expect(
            actions.stage("/repo", [change("staged", "U", "file.txt")])
        ).rejects.toThrow("cannot be staged");
        await expect(
            actions.unstage("/repo", [
                change("unstaged", "U", "file.txt"),
            ])
        ).rejects.toThrow("cannot be unstaged");
        await expect(
            actions.discard("/repo", [
                change("staged", "U", "a.txt"),
                change("unstaged", "U", "b.txt"),
            ])
        ).rejects.toThrow("same change group");
    });

    it("rejects paths that escape the selected repository before trashing", async () => {
        const repository = repositoryMock();
        const trash = vi.fn(async () => undefined);
        const actions = new SCMActionService(repository, trash);

        await expect(
            actions.discard("/repo", [
                change("untracked", "A", "../outside.txt"),
            ])
        ).rejects.toThrow("outside the selected repository");
        expect(trash).not.toHaveBeenCalled();
    });
});
