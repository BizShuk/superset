import { describe, it, expect, vi } from "vitest";

// ModifiedFilesStore imports vscode at module-load (uses
// vscode.workspace.createFileSystemWatcher in start()). We only test
// refresh() in isolation here, but the import chain pulls vscode in.
vi.mock("vscode", () => ({
    workspace: {
        createFileSystemWatcher: () => ({
            onDidChange: () => ({ dispose: () => {} }),
            onDidCreate: () => ({ dispose: () => {} }),
            onDidDelete: () => ({ dispose: () => {} }),
        }),
    },
    Disposable: class { dispose() {} },
}));

import { ModifiedFilesStore } from "../src/modifiedFiles/modifiedFilesStore";

function makeStore(errorToThrow: Error): ModifiedFilesStore {
    return new ModifiedFilesStore({
        workspaceRoot: "/Users/me/myrepo",
        debounceMs: 100,
        spawn: () => Promise.reject(errorToThrow),
        clock: () => 0,
    });
}

describe("ModifiedFilesStore error mapping (friendlyGitError)", () => {
    it("maps 'not a git repository' to actionable message with cwd", async () => {
        const store = makeStore(
            new Error(
                "Command failed: git status --porcelain\nfatal: not a git repository (or any of the parent directories): .git",
            ),
        );
        await store.refresh();
        const state = store.getState();
        expect(state.kind).toBe("error");
        if (state.kind === "error") {
            expect(state.message).toBe(
                "Not a git repository at /Users/me/myrepo. Run 'git init' or open a folder inside an existing git repo.",
            );
        }
        store.dispose();
    });

    it("strips 'Command failed:' prefix when no known pattern matches", async () => {
        const store = makeStore(
            new Error("Command failed: git status --porcelain\nsome weird git error line"),
        );
        await store.refresh();
        const state = store.getState();
        expect(state.kind).toBe("error");
        if (state.kind === "error") {
            expect(state.message).toBe("some weird git error line");
        }
        store.dispose();
    });

    it("maps timeout to its own message", async () => {
        const store = makeStore(new Error("git status timed out after 10000ms"));
        await store.refresh();
        const state = store.getState();
        expect(state.kind).toBe("error");
        if (state.kind === "error") {
            expect(state.message).toContain("timed out");
        }
        store.dispose();
    });

    it("falls back to first non-empty line for unknown errors", async () => {
        const store = makeStore(new Error("weird\nmultiline\nerror"));
        await store.refresh();
        const state = store.getState();
        expect(state.kind).toBe("error");
        if (state.kind === "error") {
            expect(state.message).toBe("weird");
        }
        store.dispose();
    });
});