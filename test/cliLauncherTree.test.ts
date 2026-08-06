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
            constructor(
                public id: string,
                public color?: { id: string }
            ) {}
        },
        ThemeColor: class ThemeColor {
            constructor(public id: string) {}
        },
    };
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "node:os";
import {
    normalizeEntrySelectors,
    normalizeHiddenRules,
    type CLIEntry,
    type EntrySelector,
    type HiddenRule,
} from "../src/cliLauncher/entries";
import type { GitFolderStatus } from "../src/cliLauncher/gitStatus";
import type { ScannedFolder } from "../src/cliLauncher/scan";

const HOME = os.homedir();

let pinned: CLIEntry[] = [];
let selectors: EntrySelector[] = [];
let scanned: ScannedFolder[] = [];
/** `superset.cliLauncher.hidden` 的 normalized literal / Regex rules。 */
let hidden: HiddenRule[] = [];
/** `superset.cliLauncher.focused` 的 normalized exact paths。 */
let focused: string[] = [];
/** Focus-only title toggle 的 persistent state。 */
let focusedOnly = false;
/** 預設 discovery 中具備自身 `.git` marker 的路徑。 */
let repositoryPaths = new Set<string>();
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

    countUnderPath(path: string): number {
        let count = 0;
        for (const [trackedPath, records] of this.records) {
            if (trackedPath === path || trackedPath.startsWith(`${path}/`)) {
                count += records.length;
            }
        }
        return count;
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
    loadEntrySelectors: () => selectors,
    loadRoots: () => [`${HOME}/projects`],
    loadHiddenRules: () => hidden,
    loadFocusedPaths: () => focused,
    loadFocusedOnly: () => focusedOnly,
}));

vi.mock("../src/cliLauncher/scan", () => ({
    scanRoots: async () => scanned,
}));

vi.mock("../src/cliLauncher/repositoryDiscovery", () => ({
    filterRepositoryFolders: async (folders: ScannedFolder[]) =>
        folders.flatMap((folder) => {
            const children = folder.children.filter((child) =>
                repositoryPaths.has(child.path)
            );
            return repositoryPaths.has(folder.entry.path) || children.length > 0
                ? [{ entry: folder.entry, children }]
                : [];
        }),
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

const { AUTO_REFRESH_INTERVAL_MS, CLILauncherTreeProvider } =
    await import("../src/cliLauncher/tree");

function entry(target: string, label?: string): CLIEntry {
    return {
        id: target,
        label: label ?? target.slice(target.lastIndexOf("/") + 1),
        path: target,
    };
}

beforeEach(() => {
    pinned = [entry("/opt/tools/cli", "Ops CLI")];
    selectors = normalizeEntrySelectors(pinned, HOME);
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
    repositoryPaths = new Set(
        scanned.flatMap((folder) => [
            folder.entry.path,
            ...folder.children.map((child) => child.path),
        ])
    );
    gitStatus = new Map();
    gitReads = 0;
    hidden = [];
    focused = [];
    focusedOnly = false;
});

describe("CLILauncherTreeProvider", () => {
    it("lists pinned entries before scanned folders", async () => {
        const provider = new CLILauncherTreeProvider();

        const items = await provider.getChildren();
        expect(items.map((item) => item.label)).toEqual([
            "Ops CLI",
            "platform",
            "ai",
        ]);
        provider.dispose();
    });

    it("shows only Focused paths while retaining an unfocused ancestor category", async () => {
        focused = [`${HOME}/projects/platform/superset`];
        focusedOnly = true;
        const provider = new CLILauncherTreeProvider();

        const items = await provider.getChildren();
        expect(items.map((item) => item.label)).toEqual(["platform"]);
        expect(items[0].contextValue).toBe(
            "superset.cliLauncher.folder"
        );

        const children = await provider.getChildren(items[0]);
        expect(children.map((item) => item.label)).toEqual(["superset"]);
        expect(children[0].contextValue).toBe(
            "superset.cliLauncher.folder.focused"
        );
        provider.dispose();
    });

    it("marks exact Focused rows without filtering while Focus-only mode is off", async () => {
        focused = [
            "/opt/tools/cli",
            `${HOME}/projects/platform/superset`,
        ];
        const provider = new CLILauncherTreeProvider();

        const items = await provider.getChildren();
        expect(items.map((item) => item.label)).toEqual([
            "Ops CLI",
            "platform",
            "ai",
        ]);
        expect(items[0].contextValue).toBe(
            "superset.cliLauncher.entry.focused"
        );
        const platformChildren = await provider.getChildren(items[1]);
        expect(platformChildren.map((item) => item.contextValue)).toEqual([
            "superset.cliLauncher.folder.focused",
            "superset.cliLauncher.folder",
        ]);
        provider.dispose();
    });

    it("shows only repositories by default while explicit entries can add non-repositories", async () => {
        const category = `${HOME}/projects/platform`;
        const repository = `${category}/superset`;
        const explicitRegex = `${category}/notes`;
        const directRepository = `${HOME}/projects/direct-repo`;
        const plainChild = `${directRepository}/plain-child`;
        const omitted = `${HOME}/projects/archive`;
        const explicitLiteral = `${HOME}/projects/scratch`;
        scanned = [
            {
                entry: entry(category),
                children: [entry(repository), entry(explicitRegex)],
            },
            {
                entry: entry(directRepository),
                children: [entry(plainChild)],
            },
            { entry: entry(omitted), children: [] },
            { entry: entry(explicitLiteral), children: [] },
        ];
        repositoryPaths = new Set([repository, directRepository]);
        selectors = normalizeEntrySelectors(
            [
                { path: explicitLiteral, label: "Scratch" },
                { regex: "(?:^|/)notes$" },
            ],
            HOME
        );

        const provider = new CLILauncherTreeProvider();
        const items = await provider.getChildren();

        expect(items.map((item) => item.label)).toEqual([
            "Scratch",
            "notes",
            "platform",
            "direct-repo",
        ]);
        expect(
            (await provider.getChildren(items[2])).map((item) => item.label)
        ).toEqual(["superset"]);
        expect(await provider.getChildren(items[3])).toEqual([]);
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

    it("applies literal hidden rules to the resolved scan catalog", async () => {
        hidden = normalizeHiddenRules(
            [`${HOME}/projects/platform`],
            HOME
        );
        const provider = new CLILauncherTreeProvider();
        const items = await provider.getChildren();

        expect(items.map((item) => item.label)).toEqual(["Ops CLI", "ai"]);
        provider.dispose();
    });

    it("expands Regex entries before scanned folders and renders them as scan-derived rows", async () => {
        selectors = normalizeEntrySelectors(
            [
                { regex: "(?:^|/)superset$" },
                { path: "/opt/tools/cli", label: "Ops CLI" },
            ],
            HOME
        );
        const provider = new CLILauncherTreeProvider();
        const items = await provider.getChildren();

        expect(items.map((item) => item.label)).toEqual([
            "superset",
            "Ops CLI",
            "platform",
            "ai",
        ]);
        expect(items[0].contextValue).toBe(
            "superset.cliLauncher.folder"
        );
        const platformChildren = await provider.getChildren(items[2]);
        expect(platformChildren.map((item) => item.label)).toEqual([
            "gateway",
        ]);
        provider.dispose();
    });

    it("lets hidden Regex rules suppress Dynamic Entries but not literal entries", async () => {
        const target = `${HOME}/projects/platform/superset`;
        selectors = normalizeEntrySelectors(
            [
                { regex: "(?:^|/)superset$" },
                { path: target, label: "Explicit Superset" },
            ],
            HOME
        );
        hidden = normalizeHiddenRules(
            [{ regex: "(?:^|/)superset$" }],
            HOME
        );
        const provider = new CLILauncherTreeProvider();
        const items = await provider.getChildren();

        expect(items.map((item) => item.label)).toEqual([
            "Explicit Superset",
            "platform",
            "ai",
        ]);
        expect(items[0].contextValue).toBe(
            "superset.cliLauncher.entry"
        );
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
        // icon 固定色,不跟 count 來源聯動。
        expect(pathItem.iconPath).toEqual({
            id: "folder",
            color: { id: "charts.blue" },
        });

        const children = await provider.getChildren(pathItem);
        expect(children.map((item) => item.label)).toEqual([
            "Ops CLI · claude",
            "Ops CLI · codex",
        ]);
        expect(children.map((item) => item.description)).toEqual([
            "running",
            "idle",
        ]);
        expect(children.map((item) => item.iconPath)).toEqual([
            { id: "terminal", color: { id: "charts.blue" } },
            { id: "terminal", color: { id: "charts.blue" } },
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

    it("sums descendant terminal counts into the ancestor rows", async () => {
        const source = new FakeTerminalSource();
        const provider = providerWith(source);
        const items = await provider.getChildren();
        const platform = items[1];
        const [superset] = await provider.getChildren(platform);

        source.set(`${HOME}/projects/platform/superset`, [
            tracked(
                "t-4",
                `${HOME}/projects/platform/superset`,
                "superset · claude",
                "running"
            ),
        ]);

        // 自己開的是 🟡;父列數字全來自子資料夾,所以換成 🔵。icon 維持固定色。
        expect(superset.description).toBe("🟡 1");
        expect(platform.description).toBe("🔵 1");
        expect(superset.iconPath).toEqual({
            id: "folder",
            color: { id: "charts.blue" },
        });
        expect(platform.iconPath).toEqual({
            id: "folder",
            color: { id: "charts.blue" },
        });
        expect(platform.tooltip).toEqual({ value: "CLI terminals: 1" });
        // 父列的數字含子孫,但展開後只會列出屬於它自己的 terminal (這裡是 0)。
        expect(
            (await provider.getChildren(platform)).map((item) => item.label)
        ).toEqual(["superset", "gateway"]);
        // 只有祖先鏈受影響,同層的其他 root 維持原樣。
        expect(items[2].description).toBe("");

        // 重新建立整棵樹時同樣要算進去,不能只在 terminal 事件路徑成立。
        provider.refresh();
        const rebuilt = await provider.getChildren();
        expect(rebuilt[1].description).toBe("🔵 1");
        provider.dispose();
    });

    it("keeps the own-terminal mark when the count mixes both levels", async () => {
        const source = new FakeTerminalSource();
        const provider = providerWith(source);
        const items = await provider.getChildren();
        const platform = items[1];

        source.set(`${HOME}/projects/platform`, [
            tracked(
                "t-5",
                `${HOME}/projects/platform`,
                "platform · grok",
                "idle"
            ),
        ]);
        source.set(`${HOME}/projects/platform/superset`, [
            tracked(
                "t-6",
                `${HOME}/projects/platform/superset`,
                "superset · claude",
                "running"
            ),
        ]);

        expect(platform.description).toBe("🟡 2");
        provider.dispose();
    });
});
