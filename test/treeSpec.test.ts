import { describe, it, expect } from "vitest";
import { buildTreeItem } from "../src/modifiedFiles/treeSpec";
import type { FileStatus, TreeNode } from "../src/modifiedFiles/types";

const folder = (
    label: string,
    children: TreeNode[],
    summary: Map<FileStatus, number> = new Map(),
): TreeNode => ({ kind: "folder", label, path: label, children, statusSummary: summary });

const file = (
    label: string,
    status: FileStatus,
    oldPath?: string,
): TreeNode => {
    const base: TreeNode = { kind: "file", label, path: label, status };
    return oldPath !== undefined ? { ...base, oldPath } : base;
};

describe("treeSpec", () => {
    it("M file → iconId 'edit', contextValue 'modifiedFile', collapsibleState 'none'", () => {
        const spec = buildTreeItem(file("a.ts", "M"));
        expect(spec.iconId).toBe("edit");
        expect(spec.contextValue).toBe("modifiedFile");
        expect(spec.collapsibleState).toBe("none");
    });

    it("A file → iconId 'add'", () => {
        expect(buildTreeItem(file("a.ts", "A")).iconId).toBe("add");
    });

    it("D file → iconId 'trash'", () => {
        expect(buildTreeItem(file("a.ts", "D")).iconId).toBe("trash");
    });

    it("? file → iconId 'question'", () => {
        expect(buildTreeItem(file("a.ts", "?")).iconId).toBe("question");
    });

    it("R file → iconId 'diff' and description 'old → label'", () => {
        const spec = buildTreeItem(file("new.ts", "R", "old.ts"));
        expect(spec.iconId).toBe("diff");
        expect(spec.description).toBe("old.ts → new.ts");
    });

    it("folder → iconId 'folder', contextValue 'modifiedFolder', collapsibleState 'collapsed'", () => {
        const spec = buildTreeItem(folder("src", []));
        expect(spec.iconId).toBe("folder");
        expect(spec.contextValue).toBe("modifiedFolder");
        expect(spec.collapsibleState).toBe("collapsed");
    });

    it("folder description uses fixed order M,A,D,R,? with only nonzero", () => {
        const f = folder("src", [], new Map([["M", 3], ["A", 1], ["D", 0], ["R", 0], ["?", 0]]));
        const spec = buildTreeItem(f);
        expect(spec.description).toBe("M 3 · A 1");
    });

    it("folder tooltip contains 'N modified files'", () => {
        const f = folder("src", [], new Map([["M", 3], ["A", 1]]));
        const spec = buildTreeItem(f);
        expect(spec.tooltip).toContain("4 modified files");
    });
});