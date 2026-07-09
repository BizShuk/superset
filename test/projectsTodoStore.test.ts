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
