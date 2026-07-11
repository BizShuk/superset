import { describe, it, expect, vi } from "vitest";
import { computeRootChildren } from "../src/modifiedFiles/treeProvider";
import type { ModifiedFilesState } from "../src/modifiedFiles/modifiedFilesStore";
import type { TreeNode } from "../src/modifiedFiles/types";

// treeProvider.ts imports vscode at module-load time. We only exercise
// `computeRootChildren` (a pure function), so the mock just needs the
// names referenced at import time.
vi.mock("vscode", () => ({
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter: class {},
    ThemeIcon: class {},
    TreeItem: class {},
}));

describe("computeRootChildren", () => {
    it("loading state returns empty array", () => {
        const state: ModifiedFilesState = { kind: "loading" };
        expect(computeRootChildren(state, "/repo")).toEqual([]);
    });

    it("error state returns single warning message element", () => {
        const state: ModifiedFilesState = {
            kind: "error",
            message: "git not found in PATH",
        };
        const out = computeRootChildren(state, "/repo");
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({
            kind: "__message",
            text: "⚠ git not found in PATH",
            icon: "warning",
        });
    });

    it("ready with zero nodes returns check message with repoRoot", () => {
        const state: ModifiedFilesState = {
            kind: "ready",
            nodes: [],
            files: [],
            refreshedAt: 0,
        };
        const out = computeRootChildren(state, "/Users/me/myrepo");
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({
            kind: "__message",
            text: "No modified files (scanning /Users/me/myrepo)",
            icon: "check",
        });
    });

    it("ready with N nodes returns the nodes unchanged", () => {
        const nodes: TreeNode[] = [
            { kind: "file", label: "foo.ts", path: "foo.ts", status: "M" },
            { kind: "folder", label: "src", path: "src", children: [], statusSummary: new Map() },
        ];
        const state: ModifiedFilesState = {
            kind: "ready",
            nodes,
            files: [],
            refreshedAt: 0,
        };
        const out = computeRootChildren(state, "/repo");
        expect(out).toEqual(nodes);
    });
});