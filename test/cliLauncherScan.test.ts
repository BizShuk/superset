import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
    isListableDirectory,
    listSubdirectories,
    scanRoots,
    SCAN_DEPTH,
} from "../src/cliLauncher/scan";

describe("SCAN_DEPTH", () => {
    it("is fixed at two layers", () => {
        expect(SCAN_DEPTH).toBe(2);
    });
});

describe("isListableDirectory", () => {
    it("accepts ordinary directory names", () => {
        expect(isListableDirectory("tools")).toBe(true);
    });

    it("rejects dot-prefixed directories", () => {
        expect(isListableDirectory(".git")).toBe(false);
        expect(isListableDirectory(".config")).toBe(false);
    });

    it("rejects node_modules", () => {
        expect(isListableDirectory("node_modules")).toBe(false);
    });
});

// 對真實暫存目錄操作,驗證 readdir 過濾、排序與 symlink 處理。
describe("filesystem scanning", () => {
    let root = "";

    beforeAll(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-launcher-scan-"));

        // <root>/tools/{superset, gosdk}  ← category 底下兩個專案
        // <root>/stock/{data}             ← 專案底下一層
        // <root>/empty                    ← 沒有子目錄
        // <root>/.hidden, <root>/node_modules  ← 應被略過
        // <root>/README.md                ← 檔案,非目錄
        await fs.mkdir(path.join(root, "tools/superset"), { recursive: true });
        await fs.mkdir(path.join(root, "tools/gosdk"), { recursive: true });
        await fs.mkdir(path.join(root, "tools/.git"), { recursive: true });
        await fs.mkdir(path.join(root, "stock/data/deep"), { recursive: true });
        await fs.mkdir(path.join(root, "empty"), { recursive: true });
        await fs.mkdir(path.join(root, ".hidden"), { recursive: true });
        await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
        await fs.writeFile(path.join(root, "README.md"), "");
        await fs.symlink(path.join(root, "stock"), path.join(root, "linked"));
        await fs.symlink(
            path.join(root, "README.md"),
            path.join(root, "link.md")
        );
    });

    afterAll(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    describe("listSubdirectories", () => {
        it("lists only directories, sorted, skipping dotfiles and node_modules", async () => {
            const found = await listSubdirectories(root);
            expect(found.map((item) => path.basename(item))).toEqual([
                "empty",
                "linked",
                "stock",
                "tools",
            ]);
        });

        it("follows directory symlinks but not file symlinks", async () => {
            const found = await listSubdirectories(root);
            expect(found).toContain(path.join(root, "linked"));
            expect(found).not.toContain(path.join(root, "link.md"));
        });

        it("returns an empty list for a missing directory", async () => {
            expect(await listSubdirectories(path.join(root, "nope"))).toEqual(
                []
            );
        });
    });

    describe("scanRoots", () => {
        it("exposes layer 1 at the top and layer 2 as children, without the root itself", async () => {
            const folders = await scanRoots([root], "/Users/tester");

            expect(folders.map((folder) => folder.entry.label)).toEqual([
                "empty",
                "linked",
                "stock",
                "tools",
            ]);

            const tools = folders.find(
                (folder) => folder.entry.label === "tools"
            );
            expect(tools?.entry.path).toBe(path.join(root, "tools"));
            expect(tools?.children.map((child) => child.label)).toEqual([
                "gosdk",
                "superset",
            ]);
        });

        it("stops at two layers", async () => {
            const folders = await scanRoots([root], "/Users/tester");
            const stock = folders.find(
                (folder) => folder.entry.label === "stock"
            );

            // `stock/data` 是第二層,`stock/data/deep` 不再被展開。
            expect(stock?.children.map((child) => child.label)).toEqual([
                "data",
            ]);
            expect(JSON.stringify(stock)).not.toContain("deep");
        });

        it("leaves a layer 1 folder with no subdirectories childless", async () => {
            const folders = await scanRoots([root], "/Users/tester");
            const empty = folders.find(
                (folder) => folder.entry.label === "empty"
            );
            expect(empty?.children).toEqual([]);
        });

        it("deduplicates across roots and ignores unreadable ones", async () => {
            const folders = await scanRoots(
                [root, root, path.join(root, "nope")],
                "/Users/tester"
            );
            expect(folders).toHaveLength(4);
        });

        it("returns an empty list when no roots are configured", async () => {
            expect(await scanRoots([], "/Users/tester")).toEqual([]);
        });

        it("drops a hidden layer 1 folder together with its children", async () => {
            const folders = await scanRoots([root], "/Users/tester", [
                path.join(root, "tools"),
            ]);

            expect(folders.map((folder) => folder.entry.label)).toEqual([
                "empty",
                "linked",
                "stock",
            ]);
            expect(JSON.stringify(folders)).not.toContain("superset");
        });

        it("drops a hidden layer 2 folder but keeps its parent", async () => {
            const folders = await scanRoots([root], "/Users/tester", [
                path.join(root, "tools/gosdk"),
            ]);
            const tools = folders.find(
                (folder) => folder.entry.label === "tools"
            );

            expect(tools?.children.map((child) => child.label)).toEqual([
                "superset",
            ]);
        });

        it("does not treat a name prefix as a hidden ancestor", async () => {
            const folders = await scanRoots([root], "/Users/tester", [
                path.join(root, "too"),
            ]);
            expect(folders.map((folder) => folder.entry.label)).toContain(
                "tools"
            );
        });
    });
});
