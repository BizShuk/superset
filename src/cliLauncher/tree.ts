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
// 有 CLI-created terminal 時在最前面加 `🟡 <count>`;停在預設分支且零改動的資料夾
// 不顯示 git 段落,完整狀態改由 tooltip 提供。tooltip 只帶 git 狀態與 terminal 數。
// 展開 path 後先列 terminal,再列原本的第二層資料夾；點 terminal row 沿用
// `superset.focus`。

import * as os from "node:os";
import * as vscode from "vscode";
import { loadEntries, loadHiddenPaths, loadRoots } from "./config";
import type { CLIEntry } from "./entries";
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
    getByPath(path: string): readonly TrackedCLITerminal[];
}

const EMPTY_TERMINAL_SOURCE: CLITerminalSource = {
    onDidChange: () => ({ dispose: () => undefined }),
    getByPath: () => [],
};

function formatPathDescription(git: string, terminalCount: number): string {
    if (terminalCount === 0) {
        return git;
    }
    const count = `🟡 ${terminalCount}`;
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
            /** 目前由 CLI Launcher 建立且仍存活的 terminal 數量。 */
            terminalCount?: number;
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
        this.updateTerminalCount(terminalCount);
        this.iconPath = new vscode.ThemeIcon("folder");
        this.contextValue = options.contextValue;
        // 刻意不設 `this.command`:點擊只做選取／展開,不會直接開 terminal。
        // 要開空的 terminal 請用右鍵選單的 `Open Terminal at Path`。
    }

    updateTerminalCount(terminalCount: number): void {
        const hasChildren = this.children.length > 0 || terminalCount > 0;
        this.collapsibleState = !hasChildren
            ? vscode.TreeItemCollapsibleState.None
            : this.expanded
              ? vscode.TreeItemCollapsibleState.Expanded
              : vscode.TreeItemCollapsibleState.Collapsed;
        this.description = formatPathDescription(
            this.gitDescription,
            terminalCount
        );
        // tooltip 只回答兩件事:這個路徑現在的 git 狀態,以及開了幾個 CLI terminal。
        // git 用完整形式,description 隱藏掉的靜止狀態在這裡仍看得到。
        this.tooltip = new vscode.MarkdownString(
            [
                ...(this.gitTooltip === "" ? [] : [`\`${this.gitTooltip}\``]),
                `CLI terminals: ${terminalCount}`,
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
        this.update(tracked);
        this.iconPath = new vscode.ThemeIcon("terminal");
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
        return parent.children.map((child) =>
            this.registerPathItem(
                new CLIEntryTreeItem(child, {
                    id: `${parent.id}/${child.path}`,
                    contextValue: FOLDER_CONTEXT_VALUE,
                    git: status.get(child.path),
                    terminalCount: this.terminalSource.getByPath(child.path)
                        .length,
                })
            )
        );
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

        const items = visiblePinned.map((entry) =>
            this.registerPathItem(
                new CLIEntryTreeItem(entry, {
                    id: `pinned:${scope}${entry.path}`,
                    contextValue: ENTRY_CONTEXT_VALUE,
                    git: status.get(entry.path),
                    terminalCount: this.terminalSource.getByPath(entry.path)
                        .length,
                })
            )
        );

        for (const folder of scanned) {
            items.push(
                this.registerPathItem(
                    new CLIEntryTreeItem(folder.entry, {
                        id: `scan:${scope}${folder.entry.path}`,
                        contextValue: FOLDER_CONTEXT_VALUE,
                        children: folder.children,
                        expanded: query !== "",
                        git: status.get(folder.entry.path),
                        terminalCount: this.terminalSource.getByPath(
                            folder.entry.path
                        ).length,
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

    private refreshTerminalPath(path: string): void {
        const pathItems = [...(this.pathItems.get(path) ?? [])];
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

        if (pathItems.length === 0 && terminalItems.length === 0) {
            return;
        }
        for (const item of pathItems) {
            item.updateTerminalCount(trackedTerminals.length);
        }
        this.changed.fire([...pathItems, ...terminalItems]);
    }
}
