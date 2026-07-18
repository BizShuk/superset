import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProjectsTodoStore } from "../src/projectsTodo/projectsTodoStore";
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

describe("ProjectsTodoStore", () => {
    let tempDir: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), "superset-projects-test-"));
        vi.mocked(os.homedir).mockReturnValue(tempDir);
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("scans and loads project stores correctly", async () => {
        // Create projects root and temporary folders
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        const p1 = join(projectsDir, "cc-plugin");
        mkdirSync(p1);
        writeFileSync(join(p1, "README.todo"), "# TODO\n- [ ] Task in cc-plugin\n");

        const projectsTmpDir = join(projectsDir, "tmp");
        mkdirSync(projectsTmpDir);

        const p2 = join(projectsTmpDir, "cindy-app");
        mkdirSync(p2);
        writeFileSync(join(p2, "README.todo"), "# TODO\n- [x] Task in cindy-app @Completed\n");

        const store = new ProjectsTodoStore();
        await store.load();

        const stores = store.getStores();
        expect(stores.size).toBe(2);
        expect(stores.has(p1)).toBe(true);
        expect(stores.has(p2)).toBe(true);

        const s1 = store.getStore(p1);
        expect(s1).toBeDefined();
        expect(s1!.getCompletedCount()).toBe(0);

        const s2 = store.getStore(p2);
        expect(s2).toBeDefined();
        expect(s2!.getCompletedCount()).toBe(1);
    });

    it("removes deleted projects on subsequent load scans", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        const p1 = join(projectsDir, "proj1");
        mkdirSync(p1);
        writeFileSync(join(p1, "README.todo"), "# TODO\n- [ ] T1");

        const store = new ProjectsTodoStore();
        await store.load();
        expect(store.getStores().size).toBe(1);

        // Delete the project folder and re-scan
        rmSync(p1, { recursive: true, force: true });
        await store.load();

        expect(store.getStores().size).toBe(0);
    });

    it("calls listeners on load and reset events", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        const store = new ProjectsTodoStore();
        const listener = vi.fn();
        store.onDidChange(listener);

        await store.load();
        expect(listener).toHaveBeenCalledWith({ type: "loaded" });

        await store.reset();
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("ignores README.todo at depth 2 (group/project)", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        // ~/projects/<a>/<b>/README.todo  (depth 2, 不應收 — 非 live project 邊界)
        const nested = join(projectsDir, "product", "reports", "weekly");
        mkdirSync(nested, { recursive: true });
        writeFileSync(join(nested, "README.todo"), "# TODO\n- [ ] deep task\n");

        // ~/projects/<project>/README.todo  (depth 1, 應收)
        const topLevel = join(projectsDir, "alpha");
        mkdirSync(topLevel);
        writeFileSync(join(topLevel, "README.todo"), "# TODO\n- [ ] top level\n");

        const store = new ProjectsTodoStore();
        await store.load();

        const stores = store.getStores();
        expect(stores.size).toBe(1);
        expect(stores.has(nested)).toBe(false);
        expect(stores.has(topLevel)).toBe(true);
    });

    it("ignores README.todo at depth 3 and 4", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        // ~/projects/<a>/<b>/<project>/README.todo  (depth 3, 不應收)
        const depth3 = join(projectsDir, "a", "b", "c");
        mkdirSync(depth3, { recursive: true });
        writeFileSync(join(depth3, "README.todo"), "# TODO\n- [ ] depth3\n");

        // ~/projects/<a>/<b>/<c>/<d>/README.todo  (depth 4, 不應收)
        const depth4 = join(projectsDir, "a", "b", "c", "d");
        mkdirSync(depth4, { recursive: true });
        writeFileSync(join(depth4, "README.todo"), "# TODO\n- [ ] depth4\n");

        const store = new ProjectsTodoStore();
        await store.load();

        const stores = store.getStores();
        expect(stores.has(depth3)).toBe(false);
        expect(stores.has(depth4)).toBe(false);
    });

    it("picks up ~/projects/tmp/<project>/README.todo at depth 1 (from tmp)", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);
        mkdirSync(join(projectsDir, "tmp"));

        // ~/projects/tmp/<project>/README.todo  (tmp 的第一層子目錄, 應收)
        const tmpProj = join(projectsDir, "tmp", "inProgress");
        mkdirSync(tmpProj);
        writeFileSync(join(tmpProj, "README.todo"), "# TODO\n- [ ] tmp top\n");

        const store = new ProjectsTodoStore();
        await store.load();

        const stores = store.getStores();
        expect(stores.has(tmpProj)).toBe(true);
    });

    it("ignores paths deeper than 1 layer under tmp", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);
        mkdirSync(join(projectsDir, "tmp"));

        // ~/projects/tmp/<a>/<project>/README.todo  (tmp 的孫層, 不應收)
        const tooDeep = join(projectsDir, "tmp", "a", "b");
        mkdirSync(tooDeep, { recursive: true });
        writeFileSync(join(tooDeep, "README.todo"), "# TODO\n- [ ] too deep\n");

        const store = new ProjectsTodoStore();
        await store.load();

        const stores = store.getStores();
        expect(stores.has(tooDeep)).toBe(false);
    });

    it("skips hidden first-layer directories and still picks up visible peers", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        // ~/projects/.hidden/README.todo  (隱藏, 不應收)
        const hidden = join(projectsDir, ".hidden");
        mkdirSync(hidden);
        writeFileSync(join(hidden, "README.todo"), "# TODO\n- [ ] hidden\n");

        // ~/projects/<visible>/README.todo  (第一層可見, 應收)
        const visible = join(projectsDir, "visible-proj");
        mkdirSync(visible);
        writeFileSync(join(visible, "README.todo"), "# TODO\n- [ ] visible\n");

        // ~/projects/<visible>/.inner/README.todo  (深層隱藏, 本來就不在掃描範圍)
        const hiddenInner = join(visible, ".inner");
        mkdirSync(hiddenInner);
        writeFileSync(join(hiddenInner, "README.todo"), "# TODO\n- [ ] inner hidden\n");

        const store = new ProjectsTodoStore();
        await store.load();

        const stores = store.getStores();
        expect(stores.size).toBe(1);
        expect(stores.has(visible)).toBe(true);
        expect(stores.has(hidden)).toBe(false);
        expect(stores.has(hiddenInner)).toBe(false);
    });

    it("scans one-layer README.todo", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);
        mkdirSync(join(projectsDir, "tmp"));

        // (a) ~/projects/<project>/README.todo  ── 應收
        const aProj = join(projectsDir, "alpha");
        mkdirSync(aProj, { recursive: true });
        writeFileSync(join(aProj, "README.todo"), "# TODO\n- [ ] a\n");

        // (b) ~/projects/tmp/<project>/plans/*.md (tmp root 副產品,
        // 確認 root 仍被掃;README.todo 在 beta 不放,測試焦點是邊界)
        const bProj = join(projectsDir, "tmp", "beta");
        mkdirSync(bProj, { recursive: true });
        mkdirSync(join(bProj, "plans"));
        writeFileSync(join(bProj, "plans", "2026-07-02-b.md"), "# beta plan\n");

        // (c) ~/projects/<a>/<b>/README.todo (孫層)  ── **不**收 (one-layer 邊界)
        const deepProj = join(projectsDir, "alpha", "sub");
        mkdirSync(deepProj, { recursive: true });
        writeFileSync(join(deepProj, "README.todo"), "# TODO\n- [ ] deep\n");

        // (d) ~/projects/.hidden/README.todo  ── 不收 (dotfile 跳過)
        const hiddenProj = join(projectsDir, ".hidden");
        mkdirSync(hiddenProj, { recursive: true });
        writeFileSync(join(hiddenProj, "README.todo"), "# TODO\n- [ ] hidden\n");

        const store = new ProjectsTodoStore();
        await store.load();

        // README.todo scan:嚴格 one-layer,只看 <root>/<child>/README.todo
        // 其中 root ∈ {projects, tmp}。
        expect(store.getStores().has(aProj)).toBe(true);
        // deepProj 在 alpha/sub → 不收
        expect(store.getStores().has(deepProj)).toBe(false);
        // bProj 沒有 README.todo → 不收
        expect(store.getStores().has(bProj)).toBe(false);
        // .hidden 跳過
        expect(store.getStores().has(hiddenProj)).toBe(false);
    });

    it("survives missing ~/projects/tmp directory", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        // ~/projects 存在,但 ~/projects/tmp 不存在;tmp root 安靜跳過
        const aProj = join(projectsDir, "alpha");
        mkdirSync(aProj, { recursive: true });
        writeFileSync(join(aProj, "README.todo"), "# TODO\n- [ ] a\n");

        const store = new ProjectsTodoStore();
        await store.load();

        expect(store.getStores().size).toBe(1);
        expect(store.getStores().has(aProj)).toBe(true);
    });
});

describe("ProjectsTodoStore — workspace scan (recursive from current workspace)", () => {
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

        const store = new ProjectsTodoStore();
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

        const store = new ProjectsTodoStore();
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

        const store = new ProjectsTodoStore();
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

        const store = new ProjectsTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const stores = store.getWorkspaceStores();
        expect(stores.size).toBe(1);
        expect(stores.has(visible)).toBe(true);
    });

    it("removes deleted sub-projects on subsequent load scans", async () => {
        const d1 = join(workspaceFolder, "alpha");
        mkdirSync(d1);
        writeFileSync(join(d1, "README.todo"), "# TODO\n- [ ] alpha\n");

        const store = new ProjectsTodoStore();
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

        const store = new ProjectsTodoStore();
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

        const store = new ProjectsTodoStore();
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

        const store = new ProjectsTodoStore();
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

        const store = new ProjectsTodoStore();
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

        const store = new ProjectsTodoStore();
        await store.loadWorkspaceTodos(workspaceFolder, 5);

        const stores = store.getWorkspaceStores();
        expect(stores.has(d5)).toBe(true);
        expect(stores.has(d6)).toBe(false);
    });

    it("does not contaminate ~/projects scan when workspace scan runs", async () => {
        // ~/projects projects still drive `getStores()` separately.
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);
        const globalProj = join(projectsDir, "global-proj");
        mkdirSync(globalProj);
        writeFileSync(join(globalProj, "README.todo"), "# TODO\n- [ ] global\n");

        // Workspace scan picks up a *different* path.
        const wsProj = join(workspaceFolder, "ws-proj");
        mkdirSync(wsProj);
        writeFileSync(join(wsProj, "README.todo"), "# TODO\n- [ ] ws\n");

        const store = new ProjectsTodoStore();
        await store.load();
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        // Two independent maps, no cross-contamination.
        expect(store.getStores().has(globalProj)).toBe(true);
        expect(store.getStores().has(wsProj)).toBe(false);
        expect(store.getWorkspaceStores().has(wsProj)).toBe(true);
        expect(store.getWorkspaceStores().has(globalProj)).toBe(false);
    });
});
