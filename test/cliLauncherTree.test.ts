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
/** `superset.cliLauncher.hidden` 的內容,以及 provider 實際交給掃描的那一份。 */
let hidden: string[] = [];
let scanHidden: string[] = [];
/** 路徑 → git 分支與行數增減;沒有列出的路徑代表不是 repository。 */
let gitStatus = new Map<string, GitFolderStatus>();
let gitReads = 0;

interface FakeTrackedTerminal {
    id: string;
    path: string;
    phase: "idle" | "pending" | "running";
    terminal: {
        name: string;
        show: ReturnType<typeof vi.fn>;
    };
}

class FakeTerminalSource {
    private readonly records = new Map<string, FakeTrackedTerminal[]>();
    private readonly listeners = new Set<(path: string) => void>();

    readonly onDidChange = (listener: (path: string) => void) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    };

    getByPath(path: string): FakeTrackedTerminal[] {
        return this.records.get(path) ?? [];
    }

    set(path: string, records: FakeTrackedTerminal[]): void {
        this.records.set(path, records);
        for (const listener of this.listeners) {
            listener(path);
        }
    }
}

type ProviderWithTerminalSource = new (
    source: FakeTerminalSource
) => InstanceType<typeof CLILauncherTreeProvider>;

function providerWith(source: FakeTerminalSource) {
    const Provider =
        CLILauncherTreeProvider as unknown as ProviderWithTerminalSource;
    return new Provider(source);
}

/** 自動重刷測試用:縮短間隔,不必等真正的 30 秒。 */
function withInterval(intervalMs: number) {
    const Provider = CLILauncherTreeProvider as unknown as new (
        source: FakeTerminalSource,
        intervalMs: number
    ) => InstanceType<typeof CLILauncherTreeProvider>;
    return new Provider(new FakeTerminalSource(), intervalMs);
}

function tracked(
    id: string,
    path: string,
    name: string,
    phase: FakeTrackedTerminal["phase"]
): FakeTrackedTerminal {
    return {
        id,
        path,
        phase,
        terminal: { name, show: vi.fn() },
    };
}

vi.mock("../src/cliLauncher/config", () => ({
    loadEntries: () => pinned,
    loadRoots: () => [`${HOME}/projects`],
    loadHiddenPaths: () => hidden,
}));

// 真正的隱藏規則在 `scan.ts`;這裡只確認 provider 有把設定值交給掃描。
vi.mock("../src/cliLauncher/scan", () => ({
    scanRoots: async (
        _roots: readonly string[],
        _home: string,
        hiddenArg: readonly string[] = []
    ) => {
        scanHidden = [...hiddenArg];
        return scanned;
    },
}));

// 只換掉會 spawn `git` 的那一支;格式化仍走真實實作,description 的字串格式
// 才會被這裡的斷言釘住。
vi.mock("../src/cliLauncher/gitStatus", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/cliLauncher/gitStatus")>()),
    readGitFolderStatusMap: async (dirs: readonly string[]) => {
        gitReads += 1;
        return new Map(
            dirs
                .filter((dir) => gitStatus.has(dir))
                .map((dir) => [dir, gitStatus.get(dir)!])
        );
    },
}));

const { AUTO_REFRESH_INTERVAL_MS, CLILauncherTreeProvider } = await import(
    "../src/cliLauncher/tree"
);

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
    gitReads = 0;
    hidden = [];
    scanHidden = [];
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
            "", // 預設分支且零改動:靜止狀態不佔 description
            "", // 不是 repository
        ]);
        provider.dispose();
    });

    it("keeps the hidden clean-default-branch status in the tooltip", async () => {
        gitStatus.set(`${HOME}/projects/platform`, {
            branch: "main",
            added: 0,
            removed: 0,
        });

        const provider = new CLILauncherTreeProvider();
        const items = await provider.getChildren();

        expect(items[1].description).toBe("");
        expect(items[1].tooltip).toEqual({
            value: "`main(+0,-0)`\n\nCLI terminals: 0",
        });
        provider.dispose();
    });

    it("keeps the tooltip to git status and terminal count", async () => {
        gitStatus.set("/opt/tools/cli", {
            branch: "release",
            added: 2,
            removed: 1,
        });
        const source = new FakeTerminalSource();
        source.set("/opt/tools/cli", [
            tracked("t-1", "/opt/tools/cli", "Ops CLI · claude", "idle"),
        ]);
        const provider = providerWith(source);

        const items = await provider.getChildren();
        expect(items[0].tooltip).toEqual({
            value: "`release(+2,-1)`\n\nCLI terminals: 1",
        });
        // 不是 repository 的資料夾只剩 terminal 數。
        expect(items[2].tooltip).toEqual({ value: "CLI terminals: 0" });
        provider.dispose();
    });

    it("re-scans on an interval only while the view is visible", async () => {
        vi.useFakeTimers();
        try {
            const provider = withInterval(1000);
            let refreshes = 0;
            provider.onDidChangeTreeData(() => {
                refreshes += 1;
            });

            // 隱藏時不排 timer:掃描沒有快取,看不見的面板重掃是純浪費。
            vi.advanceTimersByTime(3000);
            expect(refreshes).toBe(0);

            provider.setVisible(true);
            vi.advanceTimersByTime(2500);
            expect(refreshes).toBe(2);

            provider.setVisible(false);
            vi.advanceTimersByTime(5000);
            expect(refreshes).toBe(2);

            provider.setVisible(true);
            provider.dispose();
            vi.advanceTimersByTime(5000);
            expect(refreshes).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("defaults to a 30s auto refresh", () => {
        expect(AUTO_REFRESH_INTERVAL_MS).toBe(30_000);
    });

    it("passes the hidden paths to the scan", async () => {
        hidden = [`${HOME}/projects/collections`];
        const provider = new CLILauncherTreeProvider();
        await provider.getChildren();

        expect(scanHidden).toEqual([`${HOME}/projects/collections`]);
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

    it("shows terminal count before git and renders focusable terminal children", async () => {
        gitStatus.set("/opt/tools/cli", {
            branch: "release",
            added: 2,
            removed: 1,
        });
        const source = new FakeTerminalSource();
        source.set("/opt/tools/cli", [
            tracked("t-1", "/opt/tools/cli", "Ops CLI · claude", "pending"),
            tracked("t-2", "/opt/tools/cli", "Ops CLI · codex", "idle"),
        ]);
        const provider = providerWith(source);

        const [pathItem] = await provider.getChildren();
        expect(pathItem.description).toBe("🟡 2 · release(+2,-1)");
        expect(pathItem.collapsibleState).toBe(1); // Collapsed

        const children = await provider.getChildren(pathItem);
        expect(children.map((item) => item.label)).toEqual([
            "Ops CLI · claude",
            "Ops CLI · codex",
        ]);
        expect(children.map((item) => item.description)).toEqual([
            "running",
            "idle",
        ]);
        expect(children[0].command).toEqual({
            command: "superset.focus",
            title: "Focus Terminal",
            arguments: [source.getByPath("/opt/tools/cli")[0].terminal],
        });

        source.set("/opt/tools/cli", [
            tracked("t-1", "/opt/tools/cli", "Ops CLI · claude", "idle"),
            tracked("t-2", "/opt/tools/cli", "Ops CLI · codex", "idle"),
        ]);
        expect(children[0].description).toBe("idle");
        provider.dispose();
    });

    it("lists terminals before nested folders and refreshes status without rereading git", async () => {
        const source = new FakeTerminalSource();
        const provider = providerWith(source);
        const items = await provider.getChildren();
        const platform = items[1];
        const readsAfterRoot = gitReads;

        source.set(`${HOME}/projects/platform`, [
            tracked(
                "t-3",
                `${HOME}/projects/platform`,
                "platform · grok",
                "running"
            ),
        ]);

        expect(gitReads).toBe(readsAfterRoot);
        expect(platform.description).toBe("🟡 1");
        const children = await provider.getChildren(platform);
        expect(children.map((item) => item.label)).toEqual([
            "platform · grok",
            "superset",
            "gateway",
        ]);
        provider.dispose();
    });
});
