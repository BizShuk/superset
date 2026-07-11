import { describe, it, expect } from "vitest";
import { build } from "../src/modifiedFiles/treeBuilder";
import type { ModifiedFile, TreeNode } from "../src/modifiedFiles/types";

const file = (path: string, status: ModifiedFile["status"] = "M"): ModifiedFile =>
    ({ path, status });

describe("treeBuilder", () => {
    it("empty input returns empty array", () => {
        expect(build([], { showUntracked: true })).toEqual([]);
    });

    it("single file with no folder ancestor returns single file root", () => {
        const out = build([file("foo.ts")], { showUntracked: true });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ kind: "file", path: "foo.ts", label: "foo.ts" });
    });

    it("multiple files in same folder produce one folder containing N files", () => {
        const out = build(
            [file("src/a.ts"), file("src/b.ts"), file("src/c.ts")],
            { showUntracked: true },
        );
        expect(out).toHaveLength(1);
        const folder = out[0] as Extract<TreeNode, { kind: "folder" }>;
        expect(folder.kind).toBe("folder");
        expect(folder.label).toBe("src");
        expect(folder.children.map(c => c.label)).toEqual(["a.ts", "b.ts", "c.ts"]);
    });

    it("nested folders are inserted recursively", () => {
        const out = build(
            [file("src/plugins/foo.ts"), file("src/plugins/bar.ts")],
            { showUntracked: true },
        );
        expect(out).toHaveLength(1);
        const src = out[0] as Extract<TreeNode, { kind: "folder" }>;
        expect(src.children).toHaveLength(1);
        const plugins = src.children[0] as Extract<TreeNode, { kind: "folder" }>;
        expect(plugins.label).toBe("plugins");
        expect(plugins.children.map(c => c.label)).toEqual(["bar.ts", "foo.ts"]);
    });

    it("folder statusSummary aggregates descendants (3M+1A)", () => {
        const out = build(
            [
                file("src/a.ts", "M"),
                file("src/b.ts", "M"),
                file("src/c.ts", "M"),
                file("src/d.ts", "A"),
            ],
            { showUntracked: true },
        );
        const folder = out[0] as Extract<TreeNode, { kind: "folder" }>;
        expect(folder.statusSummary.get("M")).toBe(3);
        expect(folder.statusSummary.get("A")).toBe(1);
    });

    it("showUntracked=false hides ? files", () => {
        const out = build(
            [file("a.ts", "M"), file("b.ts", "?")],
            { showUntracked: false },
        );
        // Recursively check no file has status "?"
        const visit = (n: TreeNode): boolean => {
            if (n.kind === "file") return n.status === "?";
            return n.children.some(visit);
        };
        expect(out.some(visit)).toBe(false);
    });

    it("showUntracked=true shows ? files", () => {
        const out = build(
            [file("a.ts", "M"), file("b.ts", "?")],
            { showUntracked: true },
        );
        const visit = (n: TreeNode): boolean => {
            if (n.kind === "file") return n.status === "?";
            return n.children.some(visit);
        };
        expect(out.some(visit)).toBe(true);
    });

    it("folder node has kind='folder' and synthetic path", () => {
        const out = build([file("src/foo.ts")], { showUntracked: true });
        const folder = out[0] as Extract<TreeNode, { kind: "folder" }>;
        expect(folder.kind).toBe("folder");
        expect(folder.path).toBe("src");
    });

    it("file node has kind='file' and no children property", () => {
        const out = build([file("foo.ts")], { showUntracked: true });
        const f = out[0] as Extract<TreeNode, { kind: "file" }>;
        expect(f.kind).toBe("file");
        expect((f as { children?: unknown }).children).toBeUndefined();
    });

    it("same-level entries sorted alphabetically (folder+file not separated)", () => {
        const out = build(
            [file("zeta.ts"), file("alpha.ts"), file("mike/inside.ts")],
            { showUntracked: true },
        );
        expect(out.map(n => n.label)).toEqual(["alpha.ts", "mike", "zeta.ts"]);
    });
});