// 掃描根目錄底下的兩層資料夾。
//
// 樹的形狀刻意對齊 `~/projects` 的兩層佈局:root 本身不是節點,
// `<root>/<layer1>` 是 top level,展開後是 `<root>/<layer1>/<layer2>`,不再往下。
// 只依賴 `node:fs`,不依賴 `vscode`,因此可以直接對真實暫存目錄做測試。

import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expandHome, type CLIEntry } from "./entries";

/** 掃描深度固定為兩層;更深的層級對「挑一個 cwd 啟動 CLI」沒有幫助。 */
export const SCAN_DEPTH = 2;

/** 一定不會出現在清單裡的目錄名。 */
export const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
    "node_modules",
]);

/** 排除 dotfile 目錄與 `node_modules`;其餘一律列出。 */
export function isListableDirectory(name: string): boolean {
    return !name.startsWith(".") && !IGNORED_DIRECTORY_NAMES.has(name);
}

/** top level (`<root>/<layer1>`) 與其下一層 (`<root>/<layer1>/<layer2>`)。 */
export interface ScannedFolder {
    entry: CLIEntry;
    children: CLIEntry[];
}

export function toEntry(target: string): CLIEntry {
    return { id: target, label: path.basename(target), path: target };
}

function byName(left: string, right: string): number {
    return path
        .basename(left)
        .localeCompare(path.basename(right), undefined, {
            sensitivity: "base",
        });
}

/**
 * 列出 `dir` 底下的直屬子目錄 (絕對路徑,依名稱排序)。
 *
 * 讀取失敗 (不存在、無權限) 一律回傳空陣列 —— 設定裡有個打錯的 root 不該讓
 * 整個面板變成錯誤畫面。symlink 需額外 `stat` 確認指向目錄,`Dirent.isDirectory()`
 * 對 symlink 一律回傳 false。
 */
export async function listSubdirectories(dir: string): Promise<string[]> {
    let items: Dirent[];
    try {
        items = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
        return [];
    }

    const found: string[] = [];
    for (const item of items) {
        if (!isListableDirectory(item.name)) {
            continue;
        }
        const target = path.join(dir, item.name);
        if (item.isDirectory()) {
            found.push(target);
        } else if (item.isSymbolicLink() && (await isDirectory(target))) {
            found.push(target);
        }
    }

    return found.sort(byName);
}

async function isDirectory(target: string): Promise<boolean> {
    try {
        return (await fs.stat(target)).isDirectory();
    } catch {
        return false;
    }
}

/**
 * 掃描所有 root,回傳 top level 節點與各自的第二層子節點。
 * 多個 root 之間以絕對路徑去重,先出現的 root 優先。
 */
export async function scanRoots(
    roots: readonly string[],
    homeDir: string
): Promise<ScannedFolder[]> {
    const seen = new Set<string>();
    const folders: ScannedFolder[] = [];

    for (const raw of roots) {
        const root = expandHome(raw, homeDir);
        if (root === "") {
            continue;
        }

        for (const layer1 of await listSubdirectories(root)) {
            if (seen.has(layer1)) {
                continue;
            }
            seen.add(layer1);
            const children = await listSubdirectories(layer1);
            folders.push({
                entry: toEntry(layer1),
                children: children.map(toEntry),
            });
        }
    }

    return folders;
}
