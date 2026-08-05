import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceTodoStore } from "../src/todo/workspaceTodoStore";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as os from "os";

vi.mock("os", async () => {
    const original = await vi.importActual<typeof os>("os");
    return {
        ...original,
        homedir: vi.fn(),
    };
});

describe("WorkspaceTodoStore — workspace scan (recursive from current workspace)", () => {
    let tempDir: string;
    let workspaceFolder: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), "superset-wsscan-"));
        vi.mocked(os.homedir).mockReturnValue(tempDir);
        workspaceFolder = join(tempDir, "workspace");
        mkdirSync(workspaceFolder);
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("finds README.todo at depths 1, 2, 3 with maxDepth=3", async () => {
        const d1 = join(workspaceFolder, "a");
        mkdirSync(d1);
        writeFileSync(join(d1, "README.todo"), "# TODO\n- [ ] d1\n");

        const d2 = join(workspaceFolder, "a", "b");
        mkdirSync(d2);
        writeFileSync(join(d2, "README.todo"), "# TODO\n- [ ] d2\n");

        const d3 = join(workspaceFolder, "a", "b", "c");
        mkdirSync(d3);
        writeFileSync(join(d3, "README.todo"), "# TODO\n- [ ] d3\n");

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const stores = store.getWorkspaceStores();
        expect(stores.size).toBe(3);
        expect(stores.has(d1)).toBe(true);
        expect(stores.has(d2)).toBe(true);
        expect(stores.has(d3)).toBe(true);
    });

    it("does NOT find depth 4 with maxDepth=3", async () => {
        const d4 = join(workspaceFolder, "a", "b", "c", "d");
        mkdirSync(d4, { recursive: true });
        writeFileSync(join(d4, "README.todo"), "# TODO\n- [ ] d4\n");

        // Also add a depth-3 README.todo to confirm we DO find that
        // — the assertion is specifically that d4 is filtered out.
        const d3 = join(workspaceFolder, "a", "b", "c");
        writeFileSync(join(d3, "README.todo"), "# TODO\n- [ ] d3\n");

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const stores = store.getWorkspaceStores();
        expect(stores.has(d4)).toBe(false);
        expect(stores.has(d3)).toBe(true);
    });

    it("skips node_modules / out / dist / coverage / build directories", async () => {
        for (const skipDir of ["node_modules", "out", "dist", "build", "coverage"]) {
            const dir = join(workspaceFolder, skipDir);
            mkdirSync(dir);
            writeFileSync(join(dir, "README.todo"), "# TODO\n- [ ] skip\n");
        }

        const visible = join(workspaceFolder, "real");
        mkdirSync(visible);
        writeFileSync(join(visible, "README.todo"), "# TODO\n- [ ] visible\n");

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const stores = store.getWorkspaceStores();
        expect(stores.size).toBe(1);
        expect(stores.has(visible)).toBe(true);
        for (const skipDir of ["node_modules", "out", "dist", "build", "coverage"]) {
            expect(stores.has(join(workspaceFolder, skipDir))).toBe(false);
        }
    });

    it("skips dot-prefix directories (.git / .vscode / .idea)", async () => {
        for (const hidden of [".git", ".vscode", ".idea"]) {
            const dir = join(workspaceFolder, hidden);
            mkdirSync(dir);
            writeFileSync(join(dir, "README.todo"), "# TODO\n- [ ] hidden\n");
        }

        const visible = join(workspaceFolder, "src");
        mkdirSync(visible);
        writeFileSync(join(visible, "README.todo"), "# TODO\n- [ ] src\n");

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const stores = store.getWorkspaceStores();
        expect(stores.size).toBe(1);
        expect(stores.has(visible)).toBe(true);
    });

    it("removes deleted sub-projects on subsequent load scans", async () => {
        const d1 = join(workspaceFolder, "alpha");
        mkdirSync(d1);
        writeFileSync(join(d1, "README.todo"), "# TODO\n- [ ] alpha\n");

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 3);
        expect(store.getWorkspaceStores().size).toBe(1);

        rmSync(d1, { recursive: true, force: true });
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        expect(store.getWorkspaceStores().size).toBe(0);
    });

    it("returns empty map when no README.todo exists in workspace", async () => {
        const only = join(workspaceFolder, "no-todo");
        mkdirSync(only);
        writeFileSync(join(only, "README.md"), "# not a todo\n");

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        expect(store.getWorkspaceStores().size).toBe(0);
    });

    it("only accepts exact 'README.todo' filename (case-sensitive)", async () => {
        // Try to confuse the matcher with other todo-like filenames.
        // Each variant gets a distinct directory via its array index.
        const variants = [
            "todo.md", // .md instead of .todo
            "TODO.md", // uppercase + .md
            "TODOs.md", // plural + .md
            "tasks.md", // synonym
            "readme.todo", // lowercase — should NOT match
        ];
        variants.forEach((v, idx) => {
            const dir = join(workspaceFolder, `variant-${idx}`);
            mkdirSync(dir);
            writeFileSync(join(dir, v), "# TODO\n- [ ] via " + v + "\n");
        });

        // And a real one — only this should be picked up
        const real = join(workspaceFolder, "real");
        mkdirSync(real);
        writeFileSync(join(real, "README.todo"), "# TODO\n- [ ] real\n");

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const stores = store.getWorkspaceStores();
        expect(stores.size).toBe(1);
        expect(stores.has(real)).toBe(true);
    });

    it("recurses through a sub-project to find nested sub-projects (no hit-then-stop)", async () => {
        // outer has README.todo at depth 1; its child also has one at depth 2.
        // Both should be picked up — monorepos commonly have services each
        // with their own README.todo nested inside a parent that also has one.
        const outer = join(workspaceFolder, "outer");
        mkdirSync(outer);
        writeFileSync(join(outer, "README.todo"), "# TODO\n- [ ] outer\n");

        const deeper = join(outer, "deeper");
        mkdirSync(deeper);
        writeFileSync(join(deeper, "README.todo"), "# TODO\n- [ ] deeper\n");

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const stores = store.getWorkspaceStores();
        expect(stores.size).toBe(2);
        expect(stores.has(outer)).toBe(true);
        expect(stores.has(deeper)).toBe(true);
    });

    it("includes the workspace root itself (depth 0) so the workspace section is never empty when root has README.todo", async () => {
        writeFileSync(join(workspaceFolder, "README.todo"), "# TODO\n- [ ] root\n");

        const nested = join(workspaceFolder, "src");
        mkdirSync(nested);
        writeFileSync(join(nested, "README.todo"), "# TODO\n- [ ] src\n");

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const stores = store.getWorkspaceStores();
        // Root IS included — otherwise a workspace with only a root
        // README.todo (the most common single-project case) would
        // show no workspace section at all.
        expect(stores.size).toBe(2);
        expect(stores.has(workspaceFolder)).toBe(true);
        expect(stores.has(nested)).toBe(true);
    });

    it("finds README.todo at depth 5 but not depth 6 with maxDepth=5", async () => {
        const d5 = join(workspaceFolder, "a", "b", "c", "d", "e");
        mkdirSync(d5, { recursive: true });
        writeFileSync(join(d5, "README.todo"), "# TODO\n- [ ] d5\n");

        const d6 = join(d5, "f");
        mkdirSync(d6);
        writeFileSync(join(d6, "README.todo"), "# TODO\n- [ ] d6\n");

        const store = new WorkspaceTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 5);

        const stores = store.getWorkspaceStores();
        expect(stores.has(d5)).toBe(true);
        expect(stores.has(d6)).toBe(false);
    });

    it("calls listeners on load and reset events", async () => {
        const store = new WorkspaceTodoStore();
        const listener = vi.fn();
        store.onDidChange(listener);

        await store.loadWorkspaceTodos(workspaceFolder, 3);
        expect(listener).toHaveBeenCalledWith({ type: "loaded" });

        await store.reset();
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
