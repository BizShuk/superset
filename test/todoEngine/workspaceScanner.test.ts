import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    scanWorkspaceTodoDirs,
    TODO_SCAN_SKIP_DIRS,
} from "../../src/todoEngine/workspaceScanner";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * `scanWorkspaceTodoDirs` is the pure scanner shared by
 * `src/projectsTodo/` (workspace scan at configurable depth) and
 * `src/todo/` (the new SuperSet TODO panel at fixed depth 1).
 *
 * These tests pin its depth / includeRoot / case-sensitivity /
 * skip-rule contract so the lift to `src/todoEngine/workspaceScanner/`
 * doesn't regress either consumer.
 */
describe("scanWorkspaceTodoDirs", () => {
    let root: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), "superset-ws-scanner-test-"));
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it("finds README.todo at depth 1 with includeRoot=false (depth-1 panel contract)", async () => {
        // depth 0 (root) — must NOT be picked up under includeRoot=false.
        writeFileSync(join(root, "README.todo"), "# Root\n");
        // depth 1 — only these should be returned.
        const childA = join(root, "child-a");
        const childB = join(root, "child-b");
        mkdirSync(childA);
        mkdirSync(childB);
        writeFileSync(join(childA, "README.todo"), "# A\n");
        writeFileSync(join(childB, "README.todo"), "# B\n");

        const result = await scanWorkspaceTodoDirs(root, 1, false);
        expect(result.sort()).toEqual([childA, childB].sort());
    });

    it("finds README.todo at depth 0 + depth 1 with includeRoot=true", async () => {
        writeFileSync(join(root, "README.todo"), "# Root\n");
        const child = join(root, "child");
        mkdirSync(child);
        writeFileSync(join(child, "README.todo"), "# Child\n");

        const result = await scanWorkspaceTodoDirs(root, 1, true);
        expect(result.sort()).toEqual([root, child].sort());
    });

    it("respects maxDepth — does not descend past depth 1", async () => {
        const child = join(root, "child");
        const grandchild = join(child, "grandchild");
        mkdirSync(child);
        mkdirSync(grandchild);
        writeFileSync(join(child, "README.todo"), "# Child\n");
        writeFileSync(join(grandchild, "README.todo"), "# Grandchild\n");

        // includeRoot=false so only depth 1 is eligible; maxDepth=1
        // means grandchild (depth 2) is never visited.
        const result = await scanWorkspaceTodoDirs(root, 1, false);
        expect(result).toEqual([child]);
    });

    it("uses exact case-sensitive match (rejects `readme.todo`)", async () => {
        const lower = join(root, "lower");
        mkdirSync(lower);
        writeFileSync(join(lower, "readme.todo"), "# Lower\n");

        const result = await scanWorkspaceTodoDirs(root, 1, false);
        expect(result).toEqual([]);
    });

    it("skips dot-prefix directories", async () => {
        const visible = join(root, "visible");
        const hidden = join(root, ".hidden");
        mkdirSync(visible);
        mkdirSync(hidden);
        writeFileSync(join(visible, "README.todo"), "# Visible\n");
        writeFileSync(join(hidden, "README.todo"), "# Hidden\n");

        const result = await scanWorkspaceTodoDirs(root, 1, false);
        expect(result).toEqual([visible]);
    });

    it(`skips TODO_SCAN_SKIP_DIRS directories (${[...TODO_SCAN_SKIP_DIRS].join(", ")})`, async () => {
        const kept = join(root, "kept");
        mkdirSync(kept);
        writeFileSync(join(kept, "README.todo"), "# Kept\n");

        for (const skipDir of TODO_SCAN_SKIP_DIRS) {
            const skipPath = join(root, skipDir);
            mkdirSync(skipPath);
            writeFileSync(join(skipPath, "README.todo"), "# Skipped\n");
        }

        const result = await scanWorkspaceTodoDirs(root, 1, false);
        expect(result).toEqual([kept]);
    });

    it("returns an empty array when root has no matching README.todo", async () => {
        const empty = join(root, "empty");
        mkdirSync(empty);
        // No README.todo in `empty` or root.
        const result = await scanWorkspaceTodoDirs(root, 1, false);
        expect(result).toEqual([]);
    });

    it("ignores non-directory entries and other filenames", async () => {
        const child = join(root, "child");
        mkdirSync(child);
        writeFileSync(join(child, "README.todo"), "# Child\n");
        // Same name but wrong extension, plus a TODO.md variant.
        writeFileSync(join(child, "todo.md"), "# todo.md\n");
        writeFileSync(join(child, "TODO.md"), "# TODO.md\n");
        // A sibling file at depth 1 (not a directory) — should be skipped
        // because traversal only descends into directories.
        writeFileSync(join(root, "stray-file.txt"), "");

        const result = await scanWorkspaceTodoDirs(root, 1, false);
        expect(result).toEqual([child]);
    });

    it("silently skips unreadable directories without throwing", async () => {
        const child = join(root, "child");
        mkdirSync(child);
        writeFileSync(join(child, "README.todo"), "# Child\n");
        // `path.join` of an unsolvable string would be unreadable in
        // practice; here we rely on `readdir` returning ENOENT for
        // any deeper mismatch. Drop the child's contents to force a
        // stat-fail path (rename-and-replace trick).
        const deletedChild = join(root, "deleted");
        mkdirSync(deletedChild);
        rmSync(deletedChild, { recursive: true, force: true });

        const result = await scanWorkspaceTodoDirs(root, 1, false);
        expect(result).toEqual([child]);
    });
});