const gitProviderMocks = vi.hoisted(() => {
    const uriFile = vi.fn((fsPath: string) => ({
        scheme: "file",
        fsPath,
        path: fsPath,
    }));
    const openRepository = vi.fn(async (rootUri: { fsPath: string }) => ({
        rootUri,
    }));
    const getAPI = vi.fn(() => ({ openRepository }));
    const exports = { getAPI };
    const activate = vi.fn(async () => exports);
    const getExtension = vi.fn(() => ({
        isActive: true,
        exports,
        activate,
    }));

    return {
        activate,
        getAPI,
        getExtension,
        openRepository,
        uriFile,
    };
});

vi.mock("vscode", () => {
    class EventEmitter<T> {
        private readonly listeners = new Set<(event: T) => void>();
        readonly event = (listener: (event: T) => void) => {
            this.listeners.add(listener);
            return { dispose: () => this.listeners.delete(listener) };
        };
        fire(event: T) {
            for (const listener of this.listeners) {
                listener(event);
            }
        }
        dispose() {
            this.listeners.clear();
        }
    }

    class TreeItem {
        description?: string;
        tooltip?: string;
        contextValue?: string;
        resourceUri?: { fsPath: string; scheme: string; path: string };
        command?: { command: string; title: string; arguments?: unknown[] };

        constructor(
            public label: string,
            public collapsibleState?: number
        ) {}
    }

    return {
        EventEmitter,
        TreeItem,
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        Uri: {
            file: gitProviderMocks.uriFile,
        },
        commands: {
            executeCommand: vi.fn(async () => undefined),
        },
        extensions: {
            getExtension: gitProviderMocks.getExtension,
        },
        window: {
            showErrorMessage: vi.fn(async () => undefined),
            showInformationMessage: vi.fn(async () => undefined),
            showInputBox: vi.fn(async () => undefined),
            showWarningMessage: vi.fn(async () => "Discard"),
        },
    };
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { CLIEntry } from "../src/cliLauncher/entries";
import type { SCMActionService } from "../src/cliLauncher/scmActions";
import type { SCMDiffProvider } from "../src/cliLauncher/scmDiff";
import type { GitSCMRepository } from "../src/cliLauncher/scmRepository";
import type { GitChange } from "../src/cliLauncher/scmStatus";
import {
    CHANGE_VIEW_ID,
    CLIChangesTreeProvider,
    SCM_TREE_CONTEXT_VALUES,
    type SCMTreeItem,
} from "../src/cliLauncher/scmTree";

function entry(path: string, label = path.split("/").at(-1) ?? path): CLIEntry {
    return { id: path, path, label };
}

function change(
    group: GitChange["group"],
    marker: GitChange["marker"],
    path: string,
    originalPath?: string
): GitChange {
    const untracked = group === "untracked";
    const conflict = marker === "!";
    return {
        group,
        marker,
        path,
        ...(originalPath ? { originalPath } : {}),
        indexStatus: untracked
            ? "?"
            : group === "staged"
              ? "M"
              : conflict
                ? "U"
                : " ",
        workTreeStatus: untracked
            ? "?"
            : group === "staged"
              ? " "
              : conflict
                ? "U"
                : marker === "D"
                  ? "D"
                  : "M",
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
        commitStaged: vi.fn(async () => undefined),
        readHeadFile: vi.fn(async () => ""),
        readIndexFile: vi.fn(async () => ""),
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe("CLIChangesTreeProvider", () => {
    let repository: GitSCMRepository;
    let actions: Pick<SCMActionService, "stage" | "unstage" | "discard">;
    let diff: Pick<SCMDiffProvider, "open">;
    let onRepositoryChanged: ReturnType<typeof vi.fn>;
    let log: ReturnType<typeof vi.fn>;
    let provider: CLIChangesTreeProvider;

    beforeEach(() => {
        repository = repositoryMock();
        actions = {
            stage: vi.fn(async () => undefined),
            unstage: vi.fn(async () => undefined),
            discard: vi.fn(async () => undefined),
        };
        diff = { open: vi.fn(async () => undefined) };
        onRepositoryChanged = vi.fn(async () => undefined);
        log = vi.fn();
        provider = new CLIChangesTreeProvider(
            repository,
            actions,
            diff,
            onRepositoryChanged,
            log
        );
        vi.mocked(vscode.commands.executeCommand).mockReset();
        vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
        gitProviderMocks.activate.mockClear();
        gitProviderMocks.getAPI.mockClear();
        gitProviderMocks.getExtension.mockClear();
        gitProviderMocks.openRepository.mockClear();
        gitProviderMocks.openRepository.mockImplementation(async (rootUri) => ({
            rootUri,
        }));
        gitProviderMocks.uriFile.mockClear();
        vi.mocked(vscode.window.showErrorMessage).mockClear();
        vi.mocked(vscode.window.showInformationMessage).mockClear();
        vi.mocked(vscode.window.showInputBox).mockReset();
        vi.mocked(vscode.window.showWarningMessage).mockReset();
        vi.mocked(vscode.window.showWarningMessage).mockResolvedValue("Discard");
    });

    afterEach(() => {
        provider.dispose();
    });

    it("starts as an empty native tree with a Repo Path selection message", async () => {
        expect(CHANGE_VIEW_ID).toBe("superset.cliLauncher.changes");
        expect(provider.message).toContain("Repo Path");
        await expect(provider.getChildren()).resolves.toEqual([]);
    });

    it("does not render loading as a persistent Tree View message", async () => {
        const pendingChanges = deferred<GitChange[]>();
        vi.mocked(repository.readChanges).mockReturnValueOnce(
            pendingChanges.promise
        );
        const messages: Array<string | undefined> = [];
        const subscription = provider.onDidChangeMessage((message) => {
            messages.push(message);
        });

        const selection = provider.setSelection([entry("/repo/project")]);
        await Promise.resolve();

        expect(messages).not.toContain("Loading changes…");

        pendingChanges.resolve([
            change("unstaged", "U", "src/changed.ts"),
        ]);
        await selection;
        expect(provider.message).toBeUndefined();
        subscription.dispose();
    });

    it("requires one repository and reports native empty states through the view message", async () => {
        await provider.setSelection([entry("/repo/one"), entry("/repo/two")]);
        expect(provider.message).toContain("一次只能檢視一個 repository");
        expect(repository.readChanges).not.toHaveBeenCalled();

        vi.mocked(repository.isRepository).mockResolvedValueOnce(false);
        await provider.setSelection([entry("/repo/category", "category")]);
        expect(provider.message).toContain("category");
        expect(provider.message).toContain("不是 Git repository");

        await provider.setSelection([entry("/repo/clean")]);
        expect(provider.message).toBe("沒有未提交變更。");
    });

    it("uses non-empty change groups as the first native tree level", async () => {
        vi.mocked(repository.readChanges).mockResolvedValueOnce([
            change("untracked", "A", "new.ts"),
            change("staged", "U", "staged.ts"),
            change("unstaged", "D", "deleted.ts"),
        ]);

        await provider.setSelection([entry("/repo/project")]);
        const groups = await provider.getChildren();

        expect(groups.map((group) => group.label)).toEqual([
            "Staged Changes",
            "Unstaged Changes",
            "Untracked Changes",
        ]);
        expect(groups.map((group) => group.description)).toEqual(["1", "1", "1"]);
        expect(groups.map((group) => group.collapsibleState)).toEqual([2, 2, 2]);
        expect(groups.map((group) => group.contextValue)).toEqual([
            SCM_TREE_CONTEXT_VALUES.staged,
            SCM_TREE_CONTEXT_VALUES.unstaged,
            SCM_TREE_CONTEXT_VALUES.untracked,
        ]);
    });

    it("renders compact folders and file resources using native TreeItems", async () => {
        vi.mocked(repository.readChanges).mockResolvedValueOnce([
            change("unstaged", "U", "src/cliLauncher/index.ts"),
            change("unstaged", "D", "README.md"),
        ]);
        await provider.setSelection([entry("/repo/project")]);

        const [group] = await provider.getChildren();
        const children = await provider.getChildren(group);
        expect(children.map((item) => item.label)).toEqual([
            "src/cliLauncher",
            "README.md",
        ]);

        const [folder, rootFile] = children;
        expect(folder.collapsibleState).toBe(2);
        expect(folder.contextValue).toBe(SCM_TREE_CONTEXT_VALUES.unstaged);
        const [nestedFile] = await provider.getChildren(folder);
        expect(nestedFile.label).toBe("index.ts");
        expect(nestedFile.description).toBe("U");
        expect(nestedFile.resourceUri?.fsPath).toBe(
            "/repo/project/src/cliLauncher/index.ts"
        );
        expect(nestedFile.command).toMatchObject({
            command: "superset.cliLauncherOpenChange",
            title: "Open Changes",
        });
        expect(rootFile.description).toBe("D");
    });

    it("opens only current file nodes in the group-aware Diff Editor", async () => {
        const current = change("staged", "U", "src/current.ts");
        vi.mocked(repository.readChanges).mockResolvedValueOnce([current]);
        await provider.setSelection([entry("/repo/project")]);
        const [group] = await provider.getChildren();
        const [folder] = await provider.getChildren(group);
        const [file] = await provider.getChildren(folder);

        await provider.openChange(file);
        await provider.openChange({ scmNodeID: "missing" });

        expect(diff.open).toHaveBeenCalledTimes(1);
        expect(diff.open).toHaveBeenCalledWith("/repo/project", current);
    });

    it("stages a native folder target and refreshes both views", async () => {
        const first = change("unstaged", "U", "src/first.ts");
        const second = change("unstaged", "U", "src/nested/second.ts");
        vi.mocked(repository.readChanges)
            .mockResolvedValueOnce([first, second])
            .mockResolvedValueOnce([
                change("staged", "U", "src/first.ts"),
                change("staged", "U", "src/nested/second.ts"),
            ]);
        await provider.setSelection([entry("/repo/project")]);
        const [group] = await provider.getChildren();
        const [folder] = await provider.getChildren(group);

        await provider.runAction("stage", folder);

        expect(actions.stage).toHaveBeenCalledWith("/repo/project", [
            first,
            second,
        ]);
        expect(onRepositoryChanged).toHaveBeenCalledTimes(1);
        expect(repository.readChanges).toHaveBeenCalledTimes(2);
    });

    it("unstages a complete top-level group", async () => {
        const first = change("staged", "U", "first.ts");
        const second = change("staged", "A", "second.ts");
        vi.mocked(repository.readChanges)
            .mockResolvedValueOnce([first, second])
            .mockResolvedValueOnce([]);
        await provider.setSelection([entry("/repo/project")]);
        const [group] = await provider.getChildren();

        await provider.runAction("unstage", group);

        expect(actions.unstage).toHaveBeenCalledWith("/repo/project", [
            first,
            second,
        ]);
    });

    it("confirms once before discarding a native group target", async () => {
        const first = change("untracked", "A", "first.ts");
        const second = change("untracked", "A", "second.ts");
        vi.mocked(repository.readChanges)
            .mockResolvedValueOnce([first, second])
            .mockResolvedValueOnce([]);
        await provider.setSelection([entry("/repo/project")]);
        const [group] = await provider.getChildren();

        await provider.runAction("discard", group);

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            expect.stringContaining("2 changes"),
            { modal: true },
            "Discard"
        );
        expect(actions.discard).toHaveBeenCalledWith("/repo/project", [
            first,
            second,
        ]);
    });

    it("ignores stale nodes and unsupported group actions", async () => {
        vi.mocked(repository.readChanges).mockResolvedValueOnce([
            change("staged", "U", "staged.ts"),
        ]);
        await provider.setSelection([entry("/repo/project")]);
        const [group] = await provider.getChildren();

        await provider.runAction("stage", group);
        await provider.runAction("unstage", { scmNodeID: "missing" });

        expect(actions.stage).not.toHaveBeenCalled();
        expect(actions.unstage).not.toHaveBeenCalled();
        expect(actions.discard).not.toHaveBeenCalled();
    });

    it("commits staged changes through a native InputBox", async () => {
        const staged = change("staged", "U", "staged.ts");
        vi.mocked(repository.readChanges)
            .mockResolvedValueOnce([staged])
            .mockResolvedValueOnce([]);
        vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(
            "  feat: native commit  "
        );
        await provider.setSelection([entry("/repo/project", "project")]);

        await provider.commitStaged();

        expect(vscode.window.showInputBox).toHaveBeenCalledWith(
            expect.objectContaining({
                title: "Commit Staged Changes",
                prompt: "Commits staged changes only.",
                value: "",
            })
        );
        const options = vi.mocked(vscode.window.showInputBox).mock.calls[0]?.[0];
        expect(options?.validateInput?.("   ")).toContain("Commit message");
        expect(repository.commitStaged).toHaveBeenCalledWith(
            "/repo/project",
            "feat: native commit"
        );
        expect(onRepositoryChanged).toHaveBeenCalledTimes(1);
    });

    it("generates a draft, restores Change, and opens the native commit prompt", async () => {
        vi.mocked(repository.readChanges)
            .mockResolvedValueOnce([change("staged", "U", "staged.ts")])
            .mockResolvedValueOnce([]);
        vi.mocked(vscode.commands.executeCommand).mockImplementation(
            async (command: string) =>
                command === "antigravity.generateCommitMessage"
                    ? "feat: generated"
                    : undefined
        );
        vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(
            "feat: generated and reviewed"
        );
        await provider.setSelection([entry("/repo/project")]);

        await provider.generateCommitMessage();

        expect(gitProviderMocks.getExtension).toHaveBeenCalledWith(
            "vscode.git"
        );
        expect(gitProviderMocks.uriFile).toHaveBeenCalledWith(
            "/repo/project"
        );
        expect(gitProviderMocks.openRepository).toHaveBeenCalledWith({
            scheme: "file",
            fsPath: "/repo/project",
            path: "/repo/project",
        });
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            "antigravity.generateCommitMessage",
            "/repo/project"
        );
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            "workbench.view.extension.cli"
        );
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            `${CHANGE_VIEW_ID}.focus`
        );
        expect(vscode.window.showInputBox).toHaveBeenCalledWith(
            expect.objectContaining({ value: "feat: generated" })
        );
        expect(repository.commitStaged).toHaveBeenCalledWith(
            "/repo/project",
            "feat: generated and reviewed"
        );
    });

    it("does not apply generated text after repository selection changes", async () => {
        const generated = deferred<string>();
        vi.mocked(repository.readChanges)
            .mockResolvedValueOnce([change("staged", "U", "first.ts")])
            .mockResolvedValueOnce([change("staged", "U", "second.ts")]);
        vi.mocked(vscode.commands.executeCommand).mockImplementation(
            (command: string) =>
                command === "antigravity.generateCommitMessage"
                    ? generated.promise
                    : Promise.resolve(undefined)
        );
        await provider.setSelection([entry("/repo/first")]);

        const generation = provider.generateCommitMessage();
        await provider.setSelection([entry("/repo/second")]);
        generated.resolve("feat: stale first message");
        await generation;

        expect(vscode.window.showInputBox).not.toHaveBeenCalled();
        expect(repository.commitStaged).not.toHaveBeenCalled();
    });

    it("discards stale status reads after the selected repository changes", async () => {
        const firstRead = deferred<GitChange[]>();
        const secondRead = deferred<GitChange[]>();
        vi.mocked(repository.readChanges)
            .mockReturnValueOnce(firstRead.promise)
            .mockReturnValueOnce(secondRead.promise);

        const first = provider.setSelection([entry("/repo/first")]);
        const second = provider.setSelection([entry("/repo/second")]);
        secondRead.resolve([change("untracked", "A", "second.ts")]);
        await second;
        firstRead.resolve([change("unstaged", "U", "first.ts")]);
        await first;

        const [group] = await provider.getChildren();
        const [file] = await provider.getChildren(group);
        expect(file.label).toBe("second.ts");
    });

    it("reports mutation failures without accepting raw repository paths", async () => {
        vi.mocked(repository.readChanges).mockResolvedValue([
            change("unstaged", "U", "updated.ts"),
        ]);
        vi.mocked(actions.stage).mockRejectedValueOnce(new Error("stage failed"));
        await provider.setSelection([entry("/repo/project")]);
        const [group] = await provider.getChildren();
        const [file] = await provider.getChildren(group);

        await provider.runAction("stage", file);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining("stage failed")
        );
        expect(log).toHaveBeenCalledWith(expect.stringContaining("stage failed"));
    });
});
