import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceTodoStore } from "../src/todo/workspaceTodoStore";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * `loadWorkspaceTodos` gained an `includeRoot` flag so the SuperSet
 * TODO panel can scope its scan to "just 1 layer right under current
 * workspace" without inheriting the workspace root's own
 * `README.todo`. Existing callers (the `Workspace TODO` panel) keep
 * the default behaviour (`includeRoot = true`).
 *
 * These tests pin both branches so the rewrite of `src/todo/index.ts`
 * (and any future regression on the contract) is caught here.
 */
describe("WorkspaceTodoStore.loadWorkspaceTodos — includeRoot flag", () => {
    let tempDir: string;
    let workspaceRoot: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), "superset-ws-depth-test-"));
        workspaceRoot = join(tempDir, "ws");
        mkdirSync(workspaceRoot);

        // depth-1 sub-projects.
        const childA = join(workspaceRoot, "child-a");
        const childB = join(workspaceRoot, "child-b");
        mkdirSync(childA);
        mkdirSync(childB);
        writeFileSync(join(childA, "README.todo"), "# A\n- [ ] a1\n");
        writeFileSync(join(childB, "README.todo"), "# B\n- [ ] b1\n");

        // depth-2 — should NOT be picked up at maxDepth=1.
        const grand = join(childA, "nested");
        mkdirSync(grand);
        writeFileSync(join(grand, "README.todo"), "# Grand\n- [ ] g1\n");
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("includeRoot=false (SuperSet TODO contract) — excludes the root's README.todo", async () => {
        // Add a README.todo at the workspace root itself. With
        // `includeRoot=false` it must NOT show up in the result.
        writeFileSync(
            join(workspaceRoot, "README.todo"),
            "# Root\n- [ ] root-only\n",
        );

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceRoot, 1, false);

        expect(store.getWorkspaceStores().has(workspaceRoot)).toBe(false);
        // depth-1 sub-projects only — child-a's nested README.todo is
        // skipped because maxDepth=1 halts recursion.
        const paths = [...store.getWorkspaceStores().keys()].sort();
        expect(paths.length).toBe(2);
        expect(paths.some((p) => p.endsWith("child-a"))).toBe(true);
        expect(paths.some((p) => p.endsWith("child-b"))).toBe(true);
    });

    it("includeRoot=true (legacy Workspace TODO contract) — keeps the root's README.todo", async () => {
        writeFileSync(
            join(workspaceRoot, "README.todo"),
            "# Root\n- [ ] root-only\n",
        );

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceRoot, 1, true);

        const paths = [...store.getWorkspaceStores().keys()].sort();
        expect(paths.length).toBe(3);
        expect(paths.includes(workspaceRoot)).toBe(true);
    });

    it("maxDepth < 1 clears prior workspace stores without throwing", async () => {
        const store = new WorkspaceTodoStore();
        // Seed with a valid scan first.
        await store.loadWorkspaceTodos(workspaceRoot, 1, false);
        expect(store.getWorkspaceStores().size).toBe(2);

        // Now feed an invalid depth. The store should clear, not throw.
        await store.loadWorkspaceTodos(workspaceRoot, 0, false);
        expect(store.getWorkspaceStores().size).toBe(0);

        await store.loadWorkspaceTodos("", 5, false);
        expect(store.getWorkspaceStores().size).toBe(0);
    });

    it("maxDepth controls how deep the recursion goes (depth-2 not reached at maxDepth=1)", async () => {
        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceRoot, 1, false);

        // child-a/nested/README.todo exists but must NOT appear.
        const paths = [...store.getWorkspaceStores().keys()];
        expect(
            paths.some((p) => p.includes("nested")),
        ).toBe(false);
    });
});