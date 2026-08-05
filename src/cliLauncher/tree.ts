// 「CLI」側邊面板的 TreeDataProvider。
//
// 刻意用 native tree view 而不是 webview:`view/item/context` 的 `inline` group
// 原生支援每列多顆按鈕 (claude / codex / grok),不需要自己維護 HTML 與 CSP。
//
// 樹的形狀:root (預設 `~/projects`) 本身不是節點,top level 直接是
// `<root>/<layer1>`,展開後是 `<root>/<layer1>/<layer2>`,不再往下。
// 使用者手動釘選的 `superset.cliLauncher.entries` 排在掃描結果之前,可被移除。
//
// Provider 另外持有一個 ephemeral 的 subsequence 過濾字串 (見 `filter.ts`),
// 只影響顯示,不進 settings。面板可見時每 30 秒自動重刷一次
// (`AUTO_REFRESH_INTERVAL_MS`),讓 git 狀態跟得上外部的 commit / checkout。
//
// 每一列的 description 顯示該路徑的 git 分支與行數增減 (見 `gitStatus.ts`),
// 有 CLI-created terminal 時在最前面加 `🟡 <count>`;這個數字含子孫路徑,收合的
// 第一層才看得出底下的第二層正在跑東西。自己沒開、數字全來自子資料夾時改用
// `🔵` —— 用顏色而不是額外文字,省下 description 的橫向空間。tree item icon 固定
// 上色 (folder / terminal 皆 `charts.blue`),不跟 count 來源或 phase 聯動;來源
// 語意只留在 description 的 🟡 / 🔵。停在預設分支且零改動的資料夾不顯示 git
// 段落,完整狀態改由 tooltip 提供。tooltip 只帶 git 狀態與 terminal 數。展開
// path 後先列 terminal,再列原本的第二層資料夾；點 terminal row 沿用
// `superset.focus`。

import * as os from "node:os";
import * as vscode from "vscode";
import { loadEntries, loadHiddenPaths, loadRoots } from "./config";
import { isDescendantPath, type CLIEntry } from "./entries";
import {
    filterCLIEntries,
    filterScannedFolders,
    normalizeFilterQuery,
} from "./filter";
import {
    formatGitFolderDescription,
    formatGitFolderStatus,
    readGitFolderStatusMap,
    type GitFolderStatus,
} from "./gitStatus";
import { scanRoots } from "./scan";
import type { TrackedCLITerminal } from "./terminalTracker";

/** 手動釘選的項目;只有這種才提供 `Unpin Path`。 */
export const ENTRY_CONTEXT_VALUE = "superset.cliLauncher.entry";

/** 掃描出來的資料夾;可啟動但不能從清單移除。 */
export const FOLDER_CONTEXT_VALUE = "superset.cliLauncher.folder";

/** CLI Launcher 建立的 terminal child row，不提供 path 的 inline agent buttons。 */
export const TERMINAL_CONTEXT_VALUE = "superset.cliLauncher.terminal";

export interface CLITerminalSource {
    readonly onDidChange: vscode.Event<string>;
    /** 只屬於這個路徑本身的 terminal;展開後列出來的就是這一批。 */
    getByPath(path: string): readonly TrackedCLITerminal[];
    /** 這個路徑加上所有子孫路徑的 terminal 數;description 的數字用這個。 */
    countUnderPath(path: string): number;
}

const EMPTY_TERMINAL_SOURCE: CLITerminalSource = {
    onDidChange: () => ({ dispose: () => undefined }),
    getByPath: () => [],
    countUnderPath: () => 0,
};

/** 一列要顯示的 terminal 數量:自己的,以及含子孫的總數。 */
interface TerminalCounts {
    own: number;
    total: number;
}

/** 自己有 terminal。 */
const OWN_TERMINAL_MARK = "🟡";

/** 自己沒有,數字全來自子資料夾。 */
const DESCENDANT_TERMINAL_MARK = "🔵";

/** Tree item icon 固定色 (與 Activity Bar CLI cyan 對齊);不跟 count / phase 聯動。 */
const ITEM_ICON_COLOR = new vscode.ThemeColor("charts.blue");

const FOLDER_ICON = new vscode.ThemeIcon("folder", ITEM_ICON_COLOR);
const TERMINAL_ICON = new vscode.ThemeIcon("terminal", ITEM_ICON_COLOR);

/**
 * description 只放`一個`數字 (含子孫的總數),來源改用顏色表示:自己有 terminal
 * 是 🟡,自己沒開、數字全來自底下是 🔵。用顏色而不是額外文字是為了省 description
 * 的橫向空間 —— 那一列還要塞 git 分支與行數增減。
 */
function formatPathDescription(git: string, counts: TerminalCounts): string {
    if (counts.total === 0) {
        return git;
    }
    const mark = counts.own > 0 ? OWN_TERMINAL_MARK : DESCENDANT_TERMINAL_MARK;
    const count = `${mark} ${counts.total}`;
    return git === "" ? count : `${count} · ${git}`;
}

export class CLIEntryTreeItem extends vscode.TreeItem {
    readonly children: readonly CLIEntry[];
    /** description 用的簡短形式;預設分支且零改動時是空字串。 */
    private readonly gitDescription: string;
    /** tooltip 用的完整形式;只要是 repository 就一定有值。 */
    private readonly gitTooltip: string;
    private readonly expanded: boolean;

    constructor(
        readonly entry: CLIEntry,
        options: {
            id: string;
            contextValue: string;
            children?: readonly CLIEntry[];
            /** 該路徑的 git 分支與行數增減;不是 repository 時省略。 */
            git?: GitFolderStatus;
            /** 有子節點時是否預設展開;過濾中才會設,讓命中的第二層直接看得到。 */
            expanded?: boolean;
            /** 這個路徑自己的 terminal 數;決定展開後有沒有 terminal rows。 */
            terminalCount?: number;
            /** 含子孫路徑的總數;省略時等於自己的數量。 */
            totalTerminalCount?: number;
        }
    ) {
        const children = options.children ?? [];
        const terminalCount = options.terminalCount ?? 0;
        const hasChildren = children.length > 0 || terminalCount > 0;
        super(
            entry.label,
            !hasChildren
                ? vscode.TreeItemCollapsibleState.None
                : options.expanded
                  ? vscode.TreeItemCollapsibleState.Expanded
                  : vscode.TreeItemCollapsibleState.Collapsed
        );

        this.children = children;
        this.gitDescription = formatGitFolderDescription(options.git);
        this.gitTooltip = formatGitFolderStatus(options.git);
        this.expanded = options.expanded ?? false;
        this.id = options.id;
        this.iconPath = FOLDER_ICON;
        this.updateTerminalCount({
            own: terminalCount,
            total: options.totalTerminalCount ?? terminalCount,
        });
        this.contextValue = options.contextValue;
        // 刻意不設 `this.command`:點擊只做選取／展開,不會直接開 terminal。
        // 要開空的 terminal 請用右鍵選單的 `Open Terminal at Path`。
    }

    /**
     * 展開狀態看`自己`的 terminal 數 (只有自己的會變成 child rows),
     * description 看`含子孫`的總數。
     */
    updateTerminalCount(counts: TerminalCounts): void {
        const hasChildren = this.children.length > 0 || counts.own > 0;
        this.collapsibleState = !hasChildren
            ? vscode.TreeItemCollapsibleState.None
            : this.expanded
              ? vscode.TreeItemCollapsibleState.Expanded
              : vscode.TreeItemCollapsibleState.Collapsed;
        this.description = formatPathDescription(this.gitDescription, counts);
        // tooltip 只回答兩件事:這個路徑現在的 git 狀態,以及開了幾個 CLI terminal。
        // git 用完整形式,description 隱藏掉的靜止狀態在這裡仍看得到。
        this.tooltip = new vscode.MarkdownString(
            [
                ...(this.gitTooltip === "" ? [] : [`\`${this.gitTooltip}\``]),
                `CLI terminals: ${counts.total}`,
            ].join("\n\n")
        );
    }
}

export class CLITerminalTreeItem extends vscode.TreeItem {
    tracked: TrackedCLITerminal;

    constructor(tracked: TrackedCLITerminal) {
        super(tracked.terminal.name, vscode.TreeItemCollapsibleState.None);
        this.tracked = tracked;
        this.id = tracked.id;
        this.iconPath = TERMINAL_ICON;
        this.update(tracked);
        this.contextValue = TERMINAL_CONTEXT_VALUE;
    }

    update(tracked: TrackedCLITerminal): void {
        this.tracked = tracked;
        this.label = tracked.terminal.name;
        this.description = tracked.phase === "idle" ? "idle" : "running";
        this.command = {
            command: "superset.focus",
            title: "Focus Terminal",
            arguments: [tracked.terminal],
        };
    }
}

export type CLILauncherTreeItem = CLIEntryTreeItem | CLITerminalTreeItem;

/**
 * 自動重刷間隔。git 分支與行數增減沒有可訂閱的事件來源,只能定期重讀;30 秒
 * 對「切過去看一眼」夠即時,又不至於讓 `readdir` + `git` 變成常駐負載。
 */
export const AUTO_REFRESH_INTERVAL_MS = 30_000;

export class CLILauncherTreeProvider
    implements vscode.TreeDataProvider<CLILauncherTreeItem>, vscode.Disposable
{
    private readonly changed = new vscode.EventEmitter<
        CLILauncherTreeItem | CLILauncherTreeItem[] | undefined
    >();
    private readonly terminalChangeSubscription: vscode.Disposable;
    private readonly pathItems = new Map<string, Set<CLIEntryTreeItem>>();
    private readonly terminalItems = new Map<string, CLITerminalTreeItem>();
    private readonly folderChildren = new WeakMap<
        CLIEntryTreeItem,
        Promise<CLIEntryTreeItem[]>
    >();

    readonly onDidChangeTreeData = this.changed.event;

    /**
     * 目前的 subsequence 過濾字串 (已正規化)。刻意只放在記憶體:過濾是
     * ephemeral UI state,不是路徑清單的一部分,不寫 settings 也不寫 `globalState`。
     */
    private query = "";

    /** View 目前可見與否;自動重刷是 UI-only work,只在可見時進行。 */
    private visible = false;
    private refreshTimer?: ReturnType<typeof setInterval>;

    constructor(
        private readonly terminalSource: CLITerminalSource = EMPTY_TERMINAL_SOURCE,
        private readonly autoRefreshIntervalMs: number = AUTO_REFRESH_INTERVAL_MS
    ) {
        this.terminalChangeSubscription = terminalSource.onDidChange((path) => {
            this.refreshTerminalPath(path);
        });
    }

    /**
     * 由 `registerViewVisibility` 驅動。面板看不見時不重掃 —— 掃描沒有快取,
     * 隱藏的面板每 30 秒打一輪 `readdir` + `git` 只是純浪費。
     */
    setVisible(visible: boolean): void {
        if (this.visible === visible) {
            return;
        }
        this.visible = visible;
        this.syncRefreshTimer();
    }

    private syncRefreshTimer(): void {
        if (this.refreshTimer !== undefined) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        if (!this.visible || this.autoRefreshIntervalMs <= 0) {
            return;
        }
        this.refreshTimer = setInterval(() => {
            this.refresh();
        }, this.autoRefreshIntervalMs);
        // 週期 timer 不得成為讓孤兒 extension host 活著的那個 handle。
        (this.refreshTimer as { unref?: () => void }).unref?.();
    }

    get filter(): string {
        return this.query;
    }

    /** 設定過濾字串;真的改變才刷新,回傳是否有變更。 */
    setFilter(raw: string): boolean {
        const next = normalizeFilterQuery(raw);
        if (next === this.query) {
            return false;
        }
        this.query = next;
        this.refresh();
        return true;
    }

    refresh(): void {
        this.pathItems.clear();
        this.terminalItems.clear();
        this.changed.fire(undefined);
    }

    getTreeItem(item: CLILauncherTreeItem): vscode.TreeItem {
        return item;
    }

    async getChildren(
        item?: CLILauncherTreeItem
    ): Promise<CLILauncherTreeItem[]> {
        if (!item) {
            return await this.topLevelItems(this.query);
        }
        if (item instanceof CLITerminalTreeItem) {
            return [];
        }

        const terminals = this.terminalSource
            .getByPath(item.entry.path)
            .map((tracked) => this.getTerminalItem(tracked));
        const folders = await this.getFolderChildren(item);
        return [...terminals, ...folders];
    }

    dispose(): void {
        this.visible = false;
        this.syncRefreshTimer();
        this.terminalChangeSubscription.dispose();
        this.pathItems.clear();
        this.terminalItems.clear();
        this.changed.dispose();
    }

    /** 第二層 git 狀態只在第一次展開時讀；terminal event 重用同一份結果。 */
    private getFolderChildren(
        parent: CLIEntryTreeItem
    ): Promise<CLIEntryTreeItem[]> {
        const cached = this.folderChildren.get(parent);
        if (cached) {
            return cached;
        }
        const loading = this.loadFolderChildren(parent);
        this.folderChildren.set(parent, loading);
        return loading;
    }

    private async loadFolderChildren(
        parent: CLIEntryTreeItem
    ): Promise<CLIEntryTreeItem[]> {
        const status = await readGitFolderStatusMap(
            parent.children.map((child) => child.path)
        );
        return parent.children.map((child) => {
            const counts = this.terminalCounts(child.path);
            return this.registerPathItem(
                new CLIEntryTreeItem(child, {
                    id: `${parent.id}/${child.path}`,
                    contextValue: FOLDER_CONTEXT_VALUE,
                    git: status.get(child.path),
                    terminalCount: counts.own,
                    totalTerminalCount: counts.total,
                })
            );
        });
    }

    private async topLevelItems(query: string): Promise<CLIEntryTreeItem[]> {
        this.pathItems.clear();
        const home = os.homedir();
        const pinned = loadEntries();
        const pinnedPaths = new Set(pinned.map((entry) => entry.path));
        // id 帶上查詢字串:VS Code 以 id 記住每一列的展開狀態,沿用同一組 id 會讓
        // 過濾後想預設展開的節點維持在上一次的摺疊狀態。
        const scope = query === "" ? "" : `${query}:`;

        const visiblePinned = filterCLIEntries(pinned, query, home);
        const scanned = filterScannedFolders(
            await scanRoots(loadRoots(), home, loadHiddenPaths()),
            query,
            home
        ).filter(
            // 已釘選的資料夾不重複出現;釘選版帶著 Unpin Path,資訊量較多。
            (folder) => !pinnedPaths.has(folder.entry.path)
        );

        // 一次把這一層要顯示的路徑全部問完,再分配給各列;逐列 await 會把數十次
        // git 呼叫串成序列,面板要等最後一個才畫得出來。
        const status = await readGitFolderStatusMap([
            ...visiblePinned.map((entry) => entry.path),
            ...scanned.map((folder) => folder.entry.path),
        ]);

        const items = visiblePinned.map((entry) => {
            const counts = this.terminalCounts(entry.path);
            return this.registerPathItem(
                new CLIEntryTreeItem(entry, {
                    id: `pinned:${scope}${entry.path}`,
                    contextValue: ENTRY_CONTEXT_VALUE,
                    git: status.get(entry.path),
                    terminalCount: counts.own,
                    totalTerminalCount: counts.total,
                })
            );
        });

        for (const folder of scanned) {
            const counts = this.terminalCounts(folder.entry.path);
            items.push(
                this.registerPathItem(
                    new CLIEntryTreeItem(folder.entry, {
                        id: `scan:${scope}${folder.entry.path}`,
                        contextValue: FOLDER_CONTEXT_VALUE,
                        children: folder.children,
                        expanded: query !== "",
                        git: status.get(folder.entry.path),
                        terminalCount: counts.own,
                        totalTerminalCount: counts.total,
                    })
                )
            );
        }

        return items;
    }

    private registerPathItem(item: CLIEntryTreeItem): CLIEntryTreeItem {
        const items = this.pathItems.get(item.entry.path) ?? new Set();
        items.add(item);
        this.pathItems.set(item.entry.path, items);
        return item;
    }

    private getTerminalItem(tracked: TrackedCLITerminal): CLITerminalTreeItem {
        const existing = this.terminalItems.get(tracked.id);
        if (existing) {
            existing.update(tracked);
            return existing;
        }
        const item = new CLITerminalTreeItem(tracked);
        this.terminalItems.set(tracked.id, item);
        return item;
    }

    private terminalCounts(path: string): TerminalCounts {
        return {
            own: this.terminalSource.getByPath(path).length,
            total: this.terminalSource.countUnderPath(path),
        };
    }

    private refreshTerminalPath(path: string): void {
        const trackedTerminals = this.terminalSource.getByPath(path);
        const liveIDs = new Set(trackedTerminals.map((tracked) => tracked.id));
        const terminalItems: CLITerminalTreeItem[] = [];

        for (const tracked of trackedTerminals) {
            const item = this.terminalItems.get(tracked.id);
            if (item) {
                item.update(tracked);
                terminalItems.push(item);
            }
        }
        for (const [id, item] of this.terminalItems) {
            if (item.tracked.path === path && !liveIDs.has(id)) {
                this.terminalItems.delete(id);
            }
        }

        // 這個路徑自己的列,加上所有祖先列 —— 祖先的 `🟡` 含子孫,不跟著更新就會
        // 停在舊數字。仍然只碰受影響的列,不重掃 roots 也不重跑 git。
        const pathItems: CLIEntryTreeItem[] = [];
        for (const [itemPath, items] of this.pathItems) {
            if (itemPath !== path && !isDescendantPath(itemPath, path)) {
                continue;
            }
            const counts = this.terminalCounts(itemPath);
            for (const item of items) {
                item.updateTerminalCount(counts);
                pathItems.push(item);
            }
        }

        if (pathItems.length === 0 && terminalItems.length === 0) {
            return;
        }
        this.changed.fire([...pathItems, ...terminalItems]);
    }
}
