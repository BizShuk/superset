vi.mock("vscode", () => {
    class Uri {
        readonly fsPath: string;

        constructor(
            readonly scheme: string,
            readonly path: string,
            readonly query = ""
        ) {
            this.fsPath = path;
        }

        static file(path: string) {
            return new Uri("file", path);
        }

        static from(parts: { scheme: string; path: string; query?: string }) {
            return new Uri(parts.scheme, parts.path, parts.query ?? "");
        }
    }

    return {
        Uri,
        commands: { executeCommand: vi.fn(async () => undefined) },
    };
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { GitSCMRepository } from "../src/cliLauncher/scmRepository";
import type { GitChange } from "../src/cliLauncher/scmStatus";
import {
    SCM_DIFF_SCHEME,
    SCMDiffProvider,
} from "../src/cliLauncher/scmDiff";

function change(
    group: GitChange["group"],
    marker: GitChange["marker"],
    path: string,
    originalPath?: string
): GitChange {
    return {
        group,
        marker,
        path,
        ...(originalPath ? { originalPath } : {}),
        indexStatus: " ",
        workTreeStatus: "M",
    };
}

describe("SCMDiffProvider", () => {
    let sandbox = "";
    let repositoryPath = "";
    let readHeadFile: ReturnType<typeof vi.fn>;
    let readIndexFile: ReturnType<typeof vi.fn>;
    let repository: GitSCMRepository;
    let provider: SCMDiffProvider;

    beforeEach(async () => {
        sandbox = await mkdtemp(join(tmpdir(), "superset-scm-diff-"));
        repositoryPath = join(sandbox, "repository");
        await mkdir(repositoryPath);
        readHeadFile = vi.fn(async (_repoPath: string, relativePath: string) =>
            `HEAD:${relativePath}`
        );
        readIndexFile = vi.fn(async (_repoPath: string, relativePath: string) =>
            `INDEX:${relativePath}`
        );
        repository = {
            isRepository: vi.fn(async () => true),
            readChanges: vi.fn(async () => []),
            stage: vi.fn(async () => undefined),
            unstage: vi.fn(async () => undefined),
            discardWorktreeChanges: vi.fn(async () => undefined),
            discardTrackedChanges: vi.fn(async () => undefined),
            isTrackedInHead: vi.fn(async () => true),
            commitStaged: vi.fn(async () => undefined),
            readHeadFile,
            readIndexFile,
        };
        provider = new SCMDiffProvider(repository);
        vi.mocked(vscode.commands.executeCommand).mockClear();
    });

    afterEach(async () => {
        provider.dispose();
        await rm(sandbox, { recursive: true, force: true });
    });

    it("opens a staged update from HEAD against the index", async () => {
        const workingPath = join(repositoryPath, "src", "updated.ts");
        await mkdir(join(repositoryPath, "src"));
        await writeFile(workingPath, "working\n");

        await provider.open(
            repositoryPath,
            change("staged", "U", "src/updated.ts")
        );

        const call = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
        expect(call?.[0]).toBe("vscode.diff");
        const left = call?.[1] as vscode.Uri;
        const right = call?.[2] as vscode.Uri;
        expect(left.scheme).toBe(SCM_DIFF_SCHEME);
        expect(right.scheme).toBe(SCM_DIFF_SCHEME);
        await expect(provider.provideTextDocumentContent(left)).resolves.toBe(
            "HEAD:src/updated.ts"
        );
        await expect(provider.provideTextDocumentContent(right)).resolves.toBe(
            "INDEX:src/updated.ts"
        );
        expect(call?.[3]).toBe("U src/updated.ts");
    });

    it("opens an unstaged update from the index against the working file", async () => {
        const workingPath = join(repositoryPath, "src", "updated.ts");
        await mkdir(join(repositoryPath, "src"));
        await writeFile(workingPath, "working\n");

        await provider.open(
            repositoryPath,
            change("unstaged", "U", "src/updated.ts")
        );

        const call = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
        const left = call?.[1] as vscode.Uri;
        const right = call?.[2] as vscode.Uri;
        await expect(provider.provideTextDocumentContent(left)).resolves.toBe(
            "INDEX:src/updated.ts"
        );
        expect(right).toMatchObject({ scheme: "file", fsPath: workingPath });
        expect(readHeadFile).not.toHaveBeenCalled();
    });

    it("opens an untracked file from an empty document", async () => {
        const workingPath = join(repositoryPath, "added.ts");
        await writeFile(workingPath, "new\n");

        await provider.open(
            repositoryPath,
            change("untracked", "A", "added.ts")
        );

        const call = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
        const left = call?.[1] as vscode.Uri;
        expect(left.scheme).toBe(SCM_DIFF_SCHEME);
        expect(provider.provideTextDocumentContent(left)).toBe("");
        expect(readHeadFile).not.toHaveBeenCalled();
        expect(readIndexFile).not.toHaveBeenCalled();
    });

    it("opens an unstaged deletion from the index against an empty document", async () => {
        await provider.open(
            repositoryPath,
            change("unstaged", "D", "deleted.ts")
        );

        const call = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
        const left = call?.[1] as vscode.Uri;
        const right = call?.[2] as vscode.Uri;
        await expect(provider.provideTextDocumentContent(left)).resolves.toBe(
            "INDEX:deleted.ts"
        );
        expect(provider.provideTextDocumentContent(right)).toBe("");
    });

    it("uses the original HEAD path and current index path for a staged rename", async () => {
        await writeFile(join(repositoryPath, "renamed.ts"), "renamed\n");

        await provider.open(
            repositoryPath,
            change("staged", "U", "renamed.ts", "original.ts")
        );

        const call = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
        const left = call?.[1] as vscode.Uri;
        const right = call?.[2] as vscode.Uri;
        await provider.provideTextDocumentContent(left);
        await provider.provideTextDocumentContent(right);
        expect(readHeadFile).toHaveBeenCalledWith(
            repositoryPath,
            "original.ts"
        );
        expect(readIndexFile).toHaveBeenCalledWith(
            repositoryPath,
            "renamed.ts"
        );
        expect(call?.[3]).toBe("U original.ts → renamed.ts");
    });

    it("uses HEAD and an empty working side when a conflicted file is missing", async () => {
        await provider.open(
            repositoryPath,
            change("unstaged", "!", "missing.ts")
        );

        const call = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
        const left = call?.[1] as vscode.Uri;
        const right = call?.[2] as vscode.Uri;
        await expect(provider.provideTextDocumentContent(left)).resolves.toBe(
            "HEAD:missing.ts"
        );
        expect(provider.provideTextDocumentContent(right)).toBe("");
    });

    it("rejects a path that escapes the selected repository", async () => {
        await expect(
            provider.open(
                repositoryPath,
                change("unstaged", "U", "../outside.ts")
            )
        ).rejects.toThrow("outside");
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });
});
