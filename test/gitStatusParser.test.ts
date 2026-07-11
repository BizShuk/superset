import { describe, it, expect, vi } from "vitest";
import { parse } from "../src/modifiedFiles/gitStatusParser";

describe("gitStatusParser", () => {
    it("empty string returns empty array", () => {
        expect(parse("")).toEqual([]);
    });

    it("parses single modified file", () => {
        expect(parse(" M src/foo.ts")).toEqual([
            { path: "src/foo.ts", status: "M" },
        ]);
    });

    it("parses single untracked file", () => {
        expect(parse("?? new.txt")).toEqual([
            { path: "new.txt", status: "?" },
        ]);
    });

    it("parses single renamed file", () => {
        expect(parse("R  old.ts -> new.ts")).toEqual([
            { path: "new.ts", oldPath: "old.ts", status: "R" },
        ]);
    });

    it("parses single deleted file", () => {
        expect(parse(" D removed.ts")).toEqual([
            { path: "removed.ts", status: "D" },
        ]);
    });

    it("parses single added (staged) file", () => {
        expect(parse("A  staged.ts")).toEqual([
            { path: "staged.ts", status: "A" },
        ]);
    });

    it("parses mixed M+A+? in one batch", () => {
        const input = [
            " M src/foo.ts",
            "A  src/bar.ts",
            "?? baz.ts",
        ].join("\n");
        expect(parse(input)).toEqual([
            { path: "src/foo.ts", status: "M" },
            { path: "src/bar.ts", status: "A" },
            { path: "baz.ts", status: "?" },
        ]);
    });

    it("handles path with spaces", () => {
        expect(parse("M  path with space.ts")).toEqual([
            { path: "path with space.ts", status: "M" },
        ]);
    });

    it("handles path with unicode (Chinese)", () => {
        expect(parse("M  src/中文.ts")).toEqual([
            { path: "src/中文.ts", status: "M" },
        ]);
    });

    it("combines staged+unstaged M (XY='MM') as M", () => {
        expect(parse("MM src/foo.ts")).toEqual([
            { path: "src/foo.ts", status: "M" },
        ]);
    });

    it("skips garbage lines with console.warn", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const input = [
            "GARBAGE_LINE_NO_MATCH",
            " M good.ts",
        ].join("\n");
        expect(parse(input)).toEqual([
            { path: "good.ts", status: "M" },
        ]);
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });

    it("parses rename with R status in XY position", () => {
        // git porcelain uses "R " (R in index) or " R" (R in worktree)
        expect(parse("R  old.ts -> new.ts")).toEqual([
            { path: "new.ts", oldPath: "old.ts", status: "R" },
        ]);
    });
});