// 「CLI」側邊面板的 TreeDataProvider。
//
// 刻意用 native tree view 而不是 webview:`view/item/context` 的 `inline` group
// 原生支援每列多顆按鈕 (claude / codex / grok),不需要自己維護 HTML 與 CSP。
//
// 樹的形狀:root (預設 `~/projects`) 本身不是節點,top level 直接是
// `<root>/<layer1>`,展開後是 `<root>/<layer1>/<layer2>`,不再往下。
// 使用者手動釘選的 `superset.cliLauncher.entries` 排在掃描結果之前,可被移除。

import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { loadEntries, loadRoots } from "./config";
import { collapseHome, type CLIEntry } from "./entries";
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
            /** 描述欄顯示的內容;省略時顯示縮寫後的完整路徑。 */
            description?: string;
        }
    ) {
        const children = options.children ?? [];
        super(
            entry.label,
            children.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );

        this.children = children;

        const shownPath = collapseHome(entry.path, os.homedir());
        this.id = options.id;
        this.description = options.description ?? shownPath;
        this.tooltip = new vscode.MarkdownString(
            [
                `**${entry.label}**`,
                "",
                `\`${shownPath}\``,
                "",
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

    refresh(): void {
        this.changed.fire(undefined);
    }

    getTreeItem(item: CLIEntryTreeItem): vscode.TreeItem {
        return item;
    }

    async getChildren(item?: CLIEntryTreeItem): Promise<CLIEntryTreeItem[]> {
        return item ? layer2Items(item) : await topLevelItems();
    }

    dispose(): void {
        this.changed.dispose();
    }
}

/** 第二層節點:leaf,description 顯示所屬的第一層資料夾。 */
function layer2Items(parent: CLIEntryTreeItem): CLIEntryTreeItem[] {
    return parent.children.map(
        (child) =>
            new CLIEntryTreeItem(child, {
                id: `${parent.id}/${child.path}`,
                contextValue: FOLDER_CONTEXT_VALUE,
                description: parent.entry.label,
            })
    );
}

async function topLevelItems(): Promise<CLIEntryTreeItem[]> {
    const home = os.homedir();
    const pinned = loadEntries();
    const pinnedPaths = new Set(pinned.map((entry) => entry.path));

    const items = pinned.map(
        (entry) =>
            new CLIEntryTreeItem(entry, {
                id: `pinned:${entry.path}`,
                contextValue: ENTRY_CONTEXT_VALUE,
            })
    );

    const scanned = await scanRoots(loadRoots(), home);
    for (const folder of scanned) {
        if (pinnedPaths.has(folder.entry.path)) {
            // 已釘選的資料夾不重複出現;釘選版帶著 Unpin Path,資訊量較多。
            continue;
        }
        items.push(
            new CLIEntryTreeItem(folder.entry, {
                id: `scan:${folder.entry.path}`,
                contextValue: FOLDER_CONTEXT_VALUE,
                children: folder.children,
                description: collapseHome(
                    path.dirname(folder.entry.path),
                    home
                ),
            })
        );
    }

    return items;
}
