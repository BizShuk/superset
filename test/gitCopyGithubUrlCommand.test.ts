import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureContext } from "../src/shared";

const mocks = vi.hoisted(() => ({
    commands: new Map<string, (...args: unknown[]) => unknown>(),
    writeText: vi.fn(async (_text: string) => undefined),
    showInformationMessage: vi.fn(async (_message: string) => undefined),
    showErrorMessage: vi.fn(async (_message: string) => undefined),
    remotes: [] as Array<{
        name: string;
        fetchUrl?: string;
        pushUrl?: string;
    }>,
}));

vi.mock("vscode", () => ({
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
    env: {
        clipboard: { writeText: mocks.writeText },
    },
    extensions: {
        getExtension: (id: string) =>
            id === "vscode.git"
                ? {
                      isActive: true,
                      exports: {
                          getAPI: () => ({
                              getRepository: () => ({
                                  rootUri: { fsPath: "/repo" },
                                  state: { remotes: mocks.remotes },
                              }),
                          }),
                      },
                      activate: vi.fn(),
                  }
                : undefined,
    },
    window: {
        showInformationMessage: mocks.showInformationMessage,
        showErrorMessage: mocks.showErrorMessage,
        showWarningMessage: vi.fn(async () => undefined),
    },
}));

const { register } = await import("../src/git/index");

function featureContext(): FeatureContext {
    return {
        context: {} as FeatureContext["context"],
        subscriptions: [],
        workspaceFolder: "/repo",
        shared: {
            statusBar: {} as FeatureContext["shared"]["statusBar"],
            diag: {} as FeatureContext["shared"]["diag"],
            log: vi.fn(),
        },
        resetHandlers: [],
    };
}

describe("Copy GitHub URL command", () => {
    beforeEach(() => {
        mocks.commands.clear();
        mocks.writeText.mockClear();
        mocks.showInformationMessage.mockClear();
        mocks.showErrorMessage.mockClear();
        mocks.remotes.splice(0, mocks.remotes.length, {
            name: "origin",
            fetchUrl: "git@github.com:BizShuk/superset.git",
        });
        register(featureContext());
    });

    it("copies a fixed-master GitHub URL for the Explorer file", async () => {
        const command = mocks.commands.get("superset.copyGitHubUrl");
        expect(command).toBeTypeOf("function");

        await command!({
            scheme: "file",
            fsPath: "/repo/src/a.ts",
        });

        expect(mocks.writeText).toHaveBeenCalledWith(
            "https://github.com/BizShuk/superset/blob/master/src/a.ts"
        );
        expect(mocks.showInformationMessage).toHaveBeenCalledWith(
            "Superset: GitHub URL copied"
        );
    });

    it("rejects command-palette invocation without an Explorer URI", async () => {
        const command = mocks.commands.get("superset.copyGitHubUrl");
        expect(command).toBeTypeOf("function");

        await command!();

        expect(mocks.showErrorMessage).toHaveBeenCalled();
        expect(mocks.writeText).not.toHaveBeenCalled();
    });

    it("does not copy when the repository has no GitHub remote", async () => {
        mocks.remotes.splice(0);
        const command = mocks.commands.get("superset.copyGitHubUrl");
        expect(command).toBeTypeOf("function");

        await command!({
            scheme: "file",
            fsPath: "/repo/src/a.ts",
        });

        expect(mocks.showErrorMessage).toHaveBeenCalledWith(
            "Superset: repository 沒有 GitHub remote"
        );
        expect(mocks.writeText).not.toHaveBeenCalled();
    });
});
