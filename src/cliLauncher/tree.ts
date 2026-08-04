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
// 只影響顯示,不進 settings。
//
// 每一列的 description 顯示該路徑的 git 分支與行數增減 (見 `gitStatus.ts`),
// 不再重複顯示路徑 —— 完整路徑留在 tooltip。

import * as os from "node:os";
import * as vscode from "vscode";
import { loadEntries, loadRoots } from "./config";
import { collapseHome, type CLIEntry } from "./entries";
import {
    filterCLIEntries,
    filterScannedFolders,
    normalizeFilterQuery,
} from "./filter";
import {
    formatGitFolderStatus,
    readGitFolderStatusMap,
    type GitFolderStatus,
} from "./gitStatus";
import { scanRoots } from "./scan";

/** 手動釘選的項目;只有這種才提供 `Unpin Path`。 */
export const ENTRY_CONTEXT_VALUE = "superset.cliLauncher.entry";

/** 掃描出來的資料夾;可啟動但不能從清單移除。 */
export const FOLDER_CONTEXT_VALUE = "superset.cliLauncher.folder";

export class CLIEntryTreeItem extends vscode.TreeItem {
    readonly children: readonly CLIEntry[];

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
        }
    ) {
        const children = options.children ?? [];
        super(
            entry.label,
            children.length === 0
                ? vscode.TreeItemCollapsibleState.None
                : options.expanded
                  ? vscode.TreeItemCollapsibleState.Expanded
                  : vscode.TreeItemCollapsibleState.Collapsed
        );

        this.children = children;

        const shownPath = collapseHome(entry.path, os.homedir());
        const status = formatGitFolderStatus(options.git);
        this.id = options.id;
        // description 空字串等同不顯示;路徑本身留在 tooltip,不再佔用列寬。
        this.description = status;
        this.tooltip = new vscode.MarkdownString(
            [
                `**${entry.label}**`,
                "",
                `\`${shownPath}\``,
                "",
                ...(status === ""
                    ? []
                    : [`git: ${status} (分支 / 新增行 / 刪除行)`, ""]),
                "右側按鈕在此路徑執行 claude / codex / grok。",
            ].join("\n")
        );
        this.iconPath = new vscode.ThemeIcon("folder");
        this.contextValue = options.contextValue;
        // 刻意不設 `this.command`:點擊只做選取／展開,不會直接開 terminal。
        // 要開空的 terminal 請用右鍵選單的 `Open Terminal at Path`。
    }
}

export class CLILauncherTreeProvider
    implements vscode.TreeDataProvider<CLIEntryTreeItem>, vscode.Disposable
{
    private readonly changed = new vscode.EventEmitter<
        CLIEntryTreeItem | undefined
    >();

    readonly onDidChangeTreeData = this.changed.event;

    /**
     * 目前的 subsequence 過濾字串 (已正規化)。刻意只放在記憶體:過濾是
     * ephemeral UI state,不是路徑清單的一部分,不寫 settings 也不寫 `globalState`。
     */
    private query = "";

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
        this.changed.fire(undefined);
    }

    getTreeItem(item: CLIEntryTreeItem): vscode.TreeItem {
        return item;
    }

    async getChildren(item?: CLIEntryTreeItem): Promise<CLIEntryTreeItem[]> {
        return item ? await layer2Items(item) : await topLevelItems(this.query);
    }

    dispose(): void {
        this.changed.dispose();
    }
}

/**
 * 第二層節點:leaf。git 狀態只在這一層被展開時才讀 —— 兩層全掃會對每個
 * `~/projects/<category>/<project>` 都 spawn 一次 git。
 */
async function layer2Items(
    parent: CLIEntryTreeItem
): Promise<CLIEntryTreeItem[]> {
    const status = await readGitFolderStatusMap(
        parent.children.map((child) => child.path)
    );

    return parent.children.map(
        (child) =>
            new CLIEntryTreeItem(child, {
                id: `${parent.id}/${child.path}`,
                contextValue: FOLDER_CONTEXT_VALUE,
                git: status.get(child.path),
            })
    );
}

async function topLevelItems(query: string): Promise<CLIEntryTreeItem[]> {
    const home = os.homedir();
    const pinned = loadEntries();
    const pinnedPaths = new Set(pinned.map((entry) => entry.path));
    // id 帶上查詢字串:VS Code 以 id 記住每一列的展開狀態,沿用同一組 id 會讓
    // 過濾後想預設展開的節點維持在上一次的摺疊狀態。
    const scope = query === "" ? "" : `${query}:`;

    const visiblePinned = filterCLIEntries(pinned, query, home);
    const scanned = filterScannedFolders(
        await scanRoots(loadRoots(), home),
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

    const items = visiblePinned.map(
        (entry) =>
            new CLIEntryTreeItem(entry, {
                id: `pinned:${scope}${entry.path}`,
                contextValue: ENTRY_CONTEXT_VALUE,
                git: status.get(entry.path),
            })
    );

    for (const folder of scanned) {
        items.push(
            new CLIEntryTreeItem(folder.entry, {
                id: `scan:${scope}${folder.entry.path}`,
                contextValue: FOLDER_CONTEXT_VALUE,
                children: folder.children,
                expanded: query !== "",
                git: status.get(folder.entry.path),
            })
        );
    }

    return items;
}
