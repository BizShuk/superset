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

    it("picks up README.todo at depth 2 (group/project)", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        // ~/projects/<group>/<project>/README.todo  (depth 2, 應收)
        const nested = join(projectsDir, "product", "reports", "weekly");
        mkdirSync(nested, { recursive: true });
        writeFileSync(join(nested, "README.todo"), "# TODO\n- [ ] deep task\n");

        // ~/projects/<group>/README.todo  (depth 1, 也要收)
        const groupOnly = join(projectsDir, "product", "reports");
        writeFileSync(join(groupOnly, "README.todo"), "# TODO\n- [ ] intermediate\n");

        const store = new ProjectsTodoStore();
        await store.load();

        const stores = store.getStores();
        expect(stores.size).toBe(2);
        expect(stores.has(nested)).toBe(true);
        expect(stores.has(groupOnly)).toBe(true);
    });

    it("picks up README.todo at depth 3 (group/sub/project) but ignores depth 4", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        // ~/projects/<a>/<b>/<project>/README.todo  (depth 3, 應收)
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
        expect(stores.has(depth3)).toBe(true);
        expect(stores.has(depth4)).toBe(false);
    });

    it("still picks up ~/projects/tmp/<project>/README.todo at depth 2", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);
        mkdirSync(join(projectsDir, "tmp"));

        // ~/projects/tmp/<a>/<project>/README.todo  (depth 3 from ~/projects, 應收)
        const nested = join(projectsDir, "tmp", "a", "b");
        mkdirSync(nested, { recursive: true });
        writeFileSync(join(nested, "README.todo"), "# TODO\n- [ ] tmp nested\n");

        const store = new ProjectsTodoStore();
        await store.load();

        const stores = store.getStores();
        expect(stores.has(nested)).toBe(true);
    });

    it("ignores paths deeper than 3 levels under tmp", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);
        mkdirSync(join(projectsDir, "tmp"));

        // ~/projects/tmp/<a>/<b>/<project>/README.todo  (depth 4 from ~/projects, 不應收)
        const tooDeep = join(projectsDir, "tmp", "a", "b", "c");
        mkdirSync(tooDeep, { recursive: true });
        writeFileSync(join(tooDeep, "README.todo"), "# TODO\n- [ ] too deep\n");

        const store = new ProjectsTodoStore();
        await store.load();

        const stores = store.getStores();
        expect(stores.has(tooDeep)).toBe(false);
    });

    it("skips hidden directories at any depth", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        // ~/projects/.hidden/README.todo  (隱藏, 不應收)
        const hidden = join(projectsDir, ".hidden");
        mkdirSync(hidden);
        writeFileSync(join(hidden, "README.todo"), "# TODO\n- [ ] hidden\n");

        // ~/projects/<group>/.inner/README.todo  (深度 2 但隱藏, 不應收)
        const hiddenInner = join(projectsDir, "group", ".inner");
        mkdirSync(hiddenInner, { recursive: true });
        writeFileSync(join(hiddenInner, "README.todo"), "# TODO\n- [ ] inner hidden\n");

        // ~/projects/<group>/<project>/README.todo  (應收)
        const visible = join(projectsDir, "group", "proj");
        mkdirSync(visible, { recursive: true });
        writeFileSync(join(visible, "README.todo"), "# TODO\n- [ ] visible\n");

        const store = new ProjectsTodoStore();
        await store.load();

        const stores = store.getStores();
        expect(stores.size).toBe(1);
        expect(stores.has(visible)).toBe(true);
        expect(stores.has(hidden)).toBe(false);
        expect(stores.has(hiddenInner)).toBe(false);
    });

    it("scans one-layer workspace plans: only ~/projects/<p>/plans and ~/projects/tmp/<p>/plans", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);
        mkdirSync(join(projectsDir, "tmp"));

        // (a) ~/projects/<project>/plans/*.md  ── 應收
        const aProj = join(projectsDir, "alpha");
        mkdirSync(aProj, { recursive: true });
        mkdirSync(join(aProj, "plans"));
        writeFileSync(join(aProj, "plans", "2026-07-01-a.md"), "# alpha plan\n");
        writeFileSync(join(aProj, "README.todo"), "# TODO\n- [ ] a\n");

        // (b) ~/projects/tmp/<project>/plans/*.md  ── 應收
        const bProj = join(projectsDir, "tmp", "beta");
        mkdirSync(bProj, { recursive: true });
        mkdirSync(join(bProj, "plans"));
        writeFileSync(join(bProj, "plans", "2026-07-02-b.md"), "# beta plan\n");

        // (c) ~/projects/<a>/<b>/plans/*.md (孫層)  ── **不**收 (one-layer 邊界)
        //     Note: README.todo 掃描仍走最深 3 層,plan scan 嚴格 one-layer。
        const deepProj = join(projectsDir, "alpha", "sub");
        mkdirSync(deepProj, { recursive: true });
        mkdirSync(join(deepProj, "plans"));
        writeFileSync(join(deepProj, "plans", "2026-07-04-d.md"), "# deep plan\n");
        // deepProj 的 README.todo 仍會被 README walker 收到 (depth 2)
        writeFileSync(join(deepProj, "README.todo"), "# TODO\n- [ ] deep\n");

        // (d) ~/projects/plans/*.md (workspace root, 不在 project 子目錄)  ── 不收
        mkdirSync(join(projectsDir, "plans"));
        writeFileSync(join(projectsDir, "plans", "2026-07-05-r.md"), "# root plan\n");

        // (e) 隱藏的 project/plans  ── 不收
        const hiddenProj = join(projectsDir, ".hidden");
        mkdirSync(hiddenProj, { recursive: true });
        mkdirSync(join(hiddenProj, "plans"));
        writeFileSync(join(hiddenProj, "plans", "2026-07-06-h.md"), "# hidden plan\n");

        // (f) playground/exp/plans  ── **不**進 workspace plans (playground/exp 是
        //     兩層深,plan scan 嚴格 one-layer)。但其 README.todo 仍會被 stores 收。
        const playProj = join(projectsDir, "playground", "exp");
        mkdirSync(playProj, { recursive: true });
        mkdirSync(join(playProj, "plans"));
        writeFileSync(join(playProj, "plans", "2026-07-03-p.md"), "# play plan\n");
        writeFileSync(join(playProj, "README.todo"), "# TODO\n- [ ] play\n");

        const store = new ProjectsTodoStore();
        await store.load();

        // Workspace plan scan:嚴格 one-layer,只看 <root>/<child>/plans/*.md
        // 其中 root ∈ {projects, tmp}。
        const plans = store.getWorkspacePlans();
        const planBasenames = plans.map((p) => p.info.basename).sort();
        expect(planBasenames).toEqual([
            "2026-07-01-a.md",
            "2026-07-02-b.md",
        ]);

        // 對應 projectName / projectPath 標記正確
        const byName = new Map(plans.map((p) => [p.info.basename, p]));
        expect(byName.get("2026-07-01-a.md")?.projectName).toBe("alpha");
        expect(byName.get("2026-07-01-a.md")?.projectPath).toBe(aProj);
        expect(byName.get("2026-07-02-b.md")?.projectName).toBe("beta");
        expect(byName.get("2026-07-02-b.md")?.projectPath).toBe(bProj);

        // 排序:先 projectName,再 basename
        const order = plans.map((p) => `${p.projectName}/${p.info.basename}`);
        const expected = [...order].sort((x, y) => x.localeCompare(y));
        expect(order).toEqual(expected);

        // README.todo 仍照原本最深 3 層掃,playground/exp 進 stores
        expect(store.getStores().has(aProj)).toBe(true);
        expect(store.getStores().has(playProj)).toBe(true);
        expect(store.getStores().has(deepProj)).toBe(true);
    });

    it("returns [] from getWorkspacePlans when no plans folders exist", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        const store = new ProjectsTodoStore();
        await store.load();

        expect(store.getWorkspacePlans()).toEqual([]);
    });

    it("survives missing ~/projects/tmp directory", async () => {
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        // ~/projects 存在,但 ~/projects/tmp 不存在;plan scan 應安靜跳過第二 root
        const aProj = join(projectsDir, "alpha");
        mkdirSync(aProj, { recursive: true });
        mkdirSync(join(aProj, "plans"));
        writeFileSync(join(aProj, "plans", "2026-07-01-a.md"), "# a\n");

        const store = new ProjectsTodoStore();
        await store.load();

        expect(store.getWorkspacePlans().length).toBe(1);
        expect(store.getWorkspacePlans()[0]?.projectName).toBe("alpha");
    });
});
