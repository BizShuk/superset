// Tree provider 的過濾行為。`vscode` 只 mock 到 tree item 需要的表面,
// settings 與檔案系統掃描則整包換掉,讓測試只針對「過濾字串如何影響樹」。
vi.mock("vscode", () => {
    class EventEmitter<T> {
        private listeners = new Set<(e: T) => void>();
        event = (listener: (e: T) => void) => {
            this.listeners.add(listener);
            return { dispose: () => this.listeners.delete(listener) };
        };
        fire(e: T) {
            for (const l of this.listeners) l(e);
        }
        dispose() {
            this.listeners.clear();
        }
    }
    return {
        EventEmitter,
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        TreeItem: class TreeItem {
            constructor(
                public label: string,
                public collapsibleState?: number
            ) {}
        },
        MarkdownString: class MarkdownString {
            constructor(public value: string) {}
        },
        ThemeIcon: class ThemeIcon {
            constructor(public id: string) {}
        },
    };
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "node:os";
import type { CLIEntry } from "../src/cliLauncher/entries";
import type { GitFolderStatus } from "../src/cliLauncher/gitStatus";
import type { ScannedFolder } from "../src/cliLauncher/scan";

const HOME = os.homedir();

let pinned: CLIEntry[] = [];
let scanned: ScannedFolder[] = [];
/** 路徑 → git 分支與行數增減;沒有列出的路徑代表不是 repository。 */
let gitStatus = new Map<string, GitFolderStatus>();

vi.mock("../src/cliLauncher/config", () => ({
    loadEntries: () => pinned,
    loadRoots: () => [`${HOME}/projects`],
}));

vi.mock("../src/cliLauncher/scan", () => ({
    scanRoots: async () => scanned,
}));

// 只換掉會 spawn `git` 的那一支;格式化仍走真實實作,description 的字串格式
// 才會被這裡的斷言釘住。
vi.mock("../src/cliLauncher/gitStatus", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/cliLauncher/gitStatus")>()),
    readGitFolderStatusMap: async (dirs: readonly string[]) =>
        new Map(
            dirs
                .filter((dir) => gitStatus.has(dir))
                .map((dir) => [dir, gitStatus.get(dir)!])
        ),
}));

const { CLILauncherTreeProvider } = await import("../src/cliLauncher/tree");

function entry(target: string, label?: string): CLIEntry {
    return {
        id: target,
        label: label ?? target.slice(target.lastIndexOf("/") + 1),
        path: target,
    };
}

beforeEach(() => {
    pinned = [entry("/opt/tools/cli", "Ops CLI")];
    scanned = [
        {
            entry: entry(`${HOME}/projects/platform`),
            children: [
                entry(`${HOME}/projects/platform/superset`),
                entry(`${HOME}/projects/platform/gateway`),
            ],
        },
        {
            entry: entry(`${HOME}/projects/ai`),
            children: [entry(`${HOME}/projects/ai/sessiond`)],
        },
    ];
    gitStatus = new Map();
});

describe("CLILauncherTreeProvider filtering", () => {
    it("starts unfiltered and lists pinned entries before scanned folders", async () => {
        const provider = new CLILauncherTreeProvider();
        expect(provider.filter).toBe("");

        const items = await provider.getChildren();
        expect(items.map((item) => item.label)).toEqual([
            "Ops CLI",
            "platform",
            "ai",
        ]);
        provider.dispose();
    });

    it("normalizes the query and refreshes only when it changes", () => {
        const provider = new CLILauncherTreeProvider();
        let refreshes = 0;
        provider.onDidChangeTreeData(() => {
            refreshes += 1;
        });

        expect(provider.setFilter(" SUP set ")).toBe(true);
        expect(provider.filter).toBe("supset");
        expect(provider.setFilter("supset")).toBe(false);
        expect(refreshes).toBe(1);
        provider.dispose();
    });

    it("keeps only the folders reachable from the query", async () => {
        const provider = new CLILauncherTreeProvider();
        provider.setFilter("gateway");

        const items = await provider.getChildren();
        expect(items.map((item) => item.label)).toEqual(["platform"]);

        const children = await provider.getChildren(items[0]);
        expect(children.map((item) => item.label)).toEqual(["gateway"]);
        provider.dispose();
    });

    it("expands matching folders while filtering and collapses them after", async () => {
        const provider = new CLILauncherTreeProvider();
        provider.setFilter("sessiond");
        const filtered = await provider.getChildren();
        expect(filtered[0].collapsibleState).toBe(2); // Expanded

        provider.setFilter("");
        const restored = await provider.getChildren();
        expect(restored.map((item) => item.label)).toEqual([
            "Ops CLI",
            "platform",
            "ai",
        ]);
        expect(restored[1].collapsibleState).toBe(1); // Collapsed
        provider.dispose();
    });

    it("scopes item ids by the query so expansion state is not reused", async () => {
        const provider = new CLILauncherTreeProvider();
        const unfiltered = await provider.getChildren();
        provider.setFilter("ai");
        const filtered = await provider.getChildren();

        expect(unfiltered.map((item) => item.id)).not.toEqual(
            filtered.map((item) => item.id)
        );
        expect(filtered.some((item) => item.id?.includes("scan:ai:"))).toBe(
            true
        );
        provider.dispose();
    });

    it("describes each row with its branch and line deltas", async () => {
        gitStatus.set("/opt/tools/cli", {
            branch: "release",
            added: 12,
            removed: 3,
        });
        gitStatus.set(`${HOME}/projects/platform`, {
            branch: "master",
            added: 0,
            removed: 0,
        });

        const provider = new CLILauncherTreeProvider();
        const items = await provider.getChildren();

        expect(items.map((item) => item.description)).toEqual([
            "release(+12,-3)", // 釘選的 repo
            "master(+0,-0)", // 乾淨的 repo 仍顯示分支
            "", // 不是 repository
        ]);
        provider.dispose();
    });

    it("describes second layer rows with their own branch", async () => {
        gitStatus.set(`${HOME}/projects/platform/superset`, {
            branch: "w-cli-git",
            added: 4,
            removed: 0,
        });

        const provider = new CLILauncherTreeProvider();
        const items = await provider.getChildren();
        const children = await provider.getChildren(items[1]);

        expect(children.map((item) => item.description)).toEqual([
            "w-cli-git(+4,-0)",
            "",
        ]);
        provider.dispose();
    });

    it("filters pinned entries by their custom label too", async () => {
        const provider = new CLILauncherTreeProvider();
        provider.setFilter("opscli");

        const items = await provider.getChildren();
        expect(items.map((item) => item.label)).toEqual(["Ops CLI"]);
        provider.dispose();
    });
});
