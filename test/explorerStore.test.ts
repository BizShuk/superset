import { describe, it, expect, vi } from "vitest";
import { ExplorerStore, type FsAdapter } from "../src/explorerStore";
import type { ExplorerNode } from "../src/types";

function fakeFsAdapter(overrides: Partial<FsAdapter> = {}): FsAdapter {
    return {
        readDirectory: vi.fn().mockResolvedValue([]),
        getWorkspaceRoots: vi.fn().mockReturnValue([]),
        onDidChangeWorkspace: vi.fn().mockReturnValue(() => {}),
        onDidChangeFiles: vi.fn().mockReturnValue(() => {}),
        ...overrides,
    };
}

describe("ExplorerStore", () => {
    it("getRoots returns workspace roots as ExplorerNodes", () => {
        const fs = fakeFsAdapter({
            getWorkspaceRoots: vi
                .fn()
                .mockReturnValue(["/home/user/project"]),
        });
        const store = new ExplorerStore(fs);
        const roots = store.getRoots();
        expect(roots).toHaveLength(1);
        expect(roots[0].uri).toBe("/home/user/project");
        expect(roots[0].name).toBe("project");
        expect(roots[0].isDirectory).toBe(true);
        expect(roots[0].children).toBeUndefined();
    });

    it("getChildren returns directory entries lazily", async () => {
        const fs = fakeFsAdapter({
            readDirectory: vi.fn().mockResolvedValue([
                { name: "file.ts", isDirectory: false },
                { name: "sub", isDirectory: true },
            ]),
        });
        const store = new ExplorerStore(fs);
        const children = await store.getChildren("/root");
        expect(children).toHaveLength(2);
        expect(children[0].name).toBe("file.ts");
        expect(children[0].isDirectory).toBe(false);
        expect(children[1].name).toBe("sub");
        expect(children[1].isDirectory).toBe(true);
    });

    it("getChildren caches (second call returns cached)", async () => {
        const readDir = vi.fn().mockResolvedValue([
            { name: "a.ts", isDirectory: false },
        ]);
        const fs = fakeFsAdapter({ readDirectory: readDir });
        const store = new ExplorerStore(fs);
        await store.getChildren("/root");
        expect(readDir).toHaveBeenCalledTimes(1);
        await store.getChildren("/root");
        // No second call — cached
        expect(readDir).toHaveBeenCalledTimes(1);
    });

    it("refresh clears cache for a node", async () => {
        const readDir = vi.fn().mockResolvedValue([
            { name: "a.ts", isDirectory: false },
        ]);
        const fs = fakeFsAdapter({ readDirectory: readDir });
        const store = new ExplorerStore(fs);
        await store.getChildren("/root");
        expect(readDir).toHaveBeenCalledTimes(1);
        store.refresh("/root");
        await store.getChildren("/root");
        expect(readDir).toHaveBeenCalledTimes(2);
    });

    it("refreshAll clears all nodes", () => {
        const fs = fakeFsAdapter({
            getWorkspaceRoots: vi
                .fn()
                .mockReturnValue(["/a"]),
        });
        const store = new ExplorerStore(fs);
        store.getRoots();
        store.refreshAll();
        // Root nodes are re-created on next getRoots call
        const roots = store.getRoots();
        expect(roots).toHaveLength(1);
    });

    it("getParent returns parent node by URI", async () => {
        const fs = fakeFsAdapter({
            readDirectory: vi.fn().mockResolvedValue([
                { name: "child.ts", isDirectory: false },
            ]),
        });
        const store = new ExplorerStore(fs);
        await store.getChildren("/root");
        const parent = store.getParent("/root/child.ts");
        expect(parent).toBeDefined();
        expect(parent!.uri).toBe("/root");
    });

    it("getParent returns undefined for root-level URIs", () => {
        const store = new ExplorerStore(fakeFsAdapter());
        const parent = store.getParent("/root");
        expect(parent).toBeUndefined();
    });

    it("onDidChange listener receives events", () => {
        const store = new ExplorerStore(fakeFsAdapter());
        const listener = vi.fn();
        const off = store.onDidChange(listener);
        store.refreshAll();
        expect(listener).toHaveBeenCalledWith({ type: "rootChanged" });
        off();
        store.refreshAll();
        expect(listener).toHaveBeenCalledTimes(1); // unsubscribed
    });

    it("start subscribes to workspace and file changes", () => {
        const wsCb = vi.fn();
        const fileCb = vi.fn();
        const fs = fakeFsAdapter({
            onDidChangeWorkspace: vi.fn().mockReturnValue(wsCb),
            onDidChangeFiles: vi.fn().mockReturnValue(fileCb),
        });
        const store = new ExplorerStore(fs);
        store.start();
        expect(fs.onDidChangeWorkspace).toHaveBeenCalledTimes(1);
        expect(fs.onDidChangeFiles).toHaveBeenCalledTimes(1);
    });

    it("stop unsubscribes from workspace and file changes", () => {
        const wsOff = vi.fn();
        const fileOff = vi.fn();
        const fs = fakeFsAdapter({
            onDidChangeWorkspace: vi.fn().mockReturnValue(wsOff),
            onDidChangeFiles: vi.fn().mockReturnValue(fileOff),
        });
        const store = new ExplorerStore(fs);
        store.start();
        store.stop();
        expect(wsOff).toHaveBeenCalledTimes(1);
        expect(fileOff).toHaveBeenCalledTimes(1);
    });
});