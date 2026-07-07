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
});
