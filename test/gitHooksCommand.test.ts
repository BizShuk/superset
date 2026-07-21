import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureContext } from "../src/shared";

const mocks = vi.hoisted(() => ({
    commands: new Map<string, (...args: unknown[]) => unknown>(),
    workspaceFolders: [] as Array<{
        uri: { scheme: string; fsPath: string };
    }>,
    existsSync: vi.fn((_path: unknown) => false),
    statusBar: {
        text: "",
        tooltip: "",
        command: "",
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
    },
    showInformationMessage: vi.fn(async (_message: string) => undefined),
    showErrorMessage: vi.fn(async (_message: string) => undefined),
    copyMissingTree: vi.fn(async () => ({ copied: 1, skipped: 0 })),
    readLocalHooksPath: vi.fn(async () => ""),
    isGitRepository: vi.fn(async () => true),
    linkGitHooks: vi.fn(async () => undefined),
}));

vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return { ...actual, existsSync: mocks.existsSync };
});

vi.mock("../src/git/gitHooks", () => ({
    copyMissingTree: mocks.copyMissingTree,
    readLocalHooksPath: mocks.readLocalHooksPath,
    isGitRepository: mocks.isGitRepository,
    linkGitHooks: mocks.linkGitHooks,
}));

vi.mock("vscode", () => ({
    StatusBarAlignment: { Left: 1 },
    commands: {
        registerCommand: (
            id: string,
            handler: (...args: unknown[]) => unknown
        ) => {
            mocks.commands.set(id, handler);
            return { dispose: () => mocks.commands.delete(id) };
        },
        executeCommand: vi.fn(async () => undefined),
    },
    env: { clipboard: { writeText: vi.fn(async () => undefined) } },
    extensions: { getExtension: () => undefined },
    window: {
        createStatusBarItem: () => mocks.statusBar,
        showInformationMessage: mocks.showInformationMessage,
        showErrorMessage: mocks.showErrorMessage,
        showWarningMessage: vi.fn(async () => undefined),
    },
    workspace: {
        get workspaceFolders() {
            return mocks.workspaceFolders;
        },
    },
}));

const { register } = await import("../src/git/index");

function featureContext(): FeatureContext {
    return {
        context: {
            extensionUri: { fsPath: "/extension" },
        } as FeatureContext["context"],
        subscriptions: [],
        workspaceFolder: "/legacy-workspace",
        shared: {
            statusBar: {} as FeatureContext["shared"]["statusBar"],
            diag: {} as FeatureContext["shared"]["diag"],
            log: vi.fn(),
        },
        resetHandlers: [],
    };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Git hooks commands and status bar", () => {
    beforeEach(() => {
        mocks.commands.clear();
        mocks.workspaceFolders.splice(0, mocks.workspaceFolders.length, {
            uri: { scheme: "file", fsPath: "/first" },
        });
        mocks.existsSync.mockReset();
        mocks.existsSync.mockReturnValue(false);
        mocks.statusBar.text = "";
        mocks.statusBar.tooltip = "";
        mocks.statusBar.command = "";
        mocks.statusBar.show.mockClear();
        mocks.statusBar.hide.mockClear();
        mocks.statusBar.dispose.mockClear();
        mocks.showInformationMessage.mockClear();
        mocks.showErrorMessage.mockClear();
        mocks.copyMissingTree.mockReset();
        mocks.copyMissingTree.mockResolvedValue({ copied: 1, skipped: 0 });
        mocks.readLocalHooksPath.mockReset();
        mocks.readLocalHooksPath.mockResolvedValue("");
        mocks.isGitRepository.mockReset();
        mocks.isGitRepository.mockResolvedValue(true);
        mocks.linkGitHooks.mockReset();
        mocks.linkGitHooks.mockResolvedValue(undefined);
    });

    it("registers separate install and link commands", () => {
        register(featureContext());

        expect(mocks.commands.has("superset.installGitHooks")).toBe(true);
        expect(mocks.commands.has("superset.linkGitHooks")).toBe(true);
        expect(mocks.statusBar.command).toBe("superset.linkGitHooks");
        expect(mocks.statusBar.text).toBe("$(link) Git hooks not linked");
    });

    it("checks only the first opened folder", async () => {
        mocks.workspaceFolders.push({
            uri: { scheme: "file", fsPath: "/second" },
        });
        mocks.existsSync.mockReturnValue(true);
        register(featureContext());
        await settle();

        expect(mocks.isGitRepository).toHaveBeenCalledWith("/first");
        expect(mocks.isGitRepository).not.toHaveBeenCalledWith("/second");
    });

    it("shows when .githooks exists and local hooksPath is empty", async () => {
        mocks.existsSync.mockReturnValue(true);
        register(featureContext());
        await settle();

        expect(mocks.statusBar.show).toHaveBeenCalled();
    });

    it("hides for any non-empty local hooksPath", async () => {
        mocks.existsSync.mockReturnValue(true);
        mocks.readLocalHooksPath.mockResolvedValue("  .githooks  ");
        register(featureContext());
        await settle();

        expect(mocks.statusBar.hide).toHaveBeenCalled();
        expect(mocks.statusBar.show).not.toHaveBeenCalled();
    });

    it.each([
        { folders: [], exists: true, isRepo: true },
        {
            folders: [{ uri: { scheme: "vscode-remote", fsPath: "/first" } }],
            exists: true,
            isRepo: true,
        },
        {
            folders: [{ uri: { scheme: "file", fsPath: "/first" } }],
            exists: false,
            isRepo: true,
        },
        {
            folders: [{ uri: { scheme: "file", fsPath: "/first" } }],
            exists: true,
            isRepo: false,
        },
    ])("hides when status prerequisites are absent", async ({ folders, exists, isRepo }) => {
        mocks.workspaceFolders.splice(0, mocks.workspaceFolders.length, ...folders);
        mocks.existsSync.mockReturnValue(exists);
        mocks.isGitRepository.mockResolvedValue(isRepo);
        register(featureContext());
        await settle();

        expect(mocks.statusBar.hide).toHaveBeenCalled();
        expect(mocks.statusBar.show).not.toHaveBeenCalled();
    });

    it("links without installing", async () => {
        register(featureContext());
        await mocks.commands.get("superset.linkGitHooks")!();

        expect(mocks.linkGitHooks).toHaveBeenCalledWith("/first");
        expect(mocks.copyMissingTree).not.toHaveBeenCalled();
    });

    it("installs missing templates before linking", async () => {
        register(featureContext());
        await mocks.commands.get("superset.installGitHooks")!();

        expect(mocks.copyMissingTree).toHaveBeenCalledWith(
            "/extension/pkg/resources/git/githooks",
            "/first/.githooks"
        );
        expect(mocks.linkGitHooks).toHaveBeenCalledWith("/first");
        expect(mocks.copyMissingTree.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.linkGitHooks.mock.invocationCallOrder[0]
        );
    });

    it("does not link after a copy failure", async () => {
        mocks.copyMissingTree.mockRejectedValue(new Error("copy failed"));
        register(featureContext());
        await mocks.commands.get("superset.installGitHooks")!();

        expect(mocks.linkGitHooks).not.toHaveBeenCalled();
        expect(mocks.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining("copy failed")
        );
    });
});
