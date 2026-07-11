import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { detectGitRoot } from "../src/modifiedFiles/gitRoot";

describe("detectGitRoot", () => {
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "detect-git-root-"));
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("returns null when startDir is empty", () => {
        expect(detectGitRoot("")).toBeNull();
    });

    it("returns null when no .git exists anywhere up the tree", () => {
        expect(detectGitRoot(tmpRoot)).toBeNull();
    });

    it("returns startDir when .git is a directory in startDir itself", () => {
        fs.mkdirSync(path.join(tmpRoot, ".git"));
        expect(detectGitRoot(tmpRoot)).toBe(tmpRoot);
    });

    it("returns parent dir when .git is in a parent directory", () => {
        fs.mkdirSync(path.join(tmpRoot, ".git"));
        const sub = path.join(tmpRoot, "a", "b", "c");
        fs.mkdirSync(sub, { recursive: true });
        expect(detectGitRoot(sub)).toBe(tmpRoot);
    });

    it("returns dir when .git is a file (submodule / worktree pointer)", () => {
        fs.writeFileSync(path.join(tmpRoot, ".git"), "gitdir: /tmp/elsewhere/.git\n");
        expect(detectGitRoot(tmpRoot)).toBe(tmpRoot);
    });

    it("does not return a sibling-only .git — only walks up", () => {
        // .git in tmpRoot/sibling/.git should NOT be found from tmpRoot/another/
        const sibling = path.join(tmpRoot, "sibling");
        fs.mkdirSync(sibling, { recursive: true });
        fs.mkdirSync(path.join(sibling, ".git"));
        const another = path.join(tmpRoot, "another");
        fs.mkdirSync(another);
        expect(detectGitRoot(another)).toBeNull();
    });

    it("stops at filesystem root without throwing", () => {
        // Should not throw; returns null because / itself has no .git
        expect(() => detectGitRoot("/")).not.toThrow();
        expect(detectGitRoot("/")).toBeNull();
    });
});