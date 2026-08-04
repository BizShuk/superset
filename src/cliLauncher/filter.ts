// CLI Launcher 面板的路徑過濾 (pure data layer)。
//
// 比對方式是`逐段 (per segment)` 的 subsequence match:查詢以 `/` 切成數段,
// 每一段的字元必須`依序`出現在`同一個路徑段`裡,段與段之間依路徑順序推進。
//
// subsequence 不跨 `/` 是關鍵:整條路徑攤平後字元太多,`tool` 會在
// `~/projects/collections/plans` 裡湊出 t-o-o-l 而誤命中。限制在單一段內之後,
// `tool` 只會命中 `tools`,`pl/sup` 才會命中 `platform/superset`。
//
// 這一層不依賴 `vscode`,也不讀寫 settings —— 過濾字串是 ephemeral UI state,
// 由 tree provider 持有,不進 settings 也不進 `globalState`。

import { collapseHome, type CLIEntry } from "./entries";
import type { ScannedFolder } from "./scan";

/**
 * 正規化查詢字串:轉小寫、移除所有空白。
 *
 * 移除空白是因為路徑段本身不含空白分隔,使用者順手打的 `pl sup` 與 `plsup`
 * 應該是同一個查詢。回傳空字串代表「沒有過濾」。
 */
export function normalizeFilterQuery(raw: string): string {
    const compact = raw.toLowerCase().replace(/\s+/g, "");
    // 只剩分隔符 (`/`、`~/`) 的查詢沒有任何條件,等同沒有過濾 —— 不能讓它把
    // 面板標記成「過濾中」卻什麼都沒篩掉。
    return splitFilterQuery(compact).length === 0 ? "" : compact;
}

/**
 * 把查詢切成路徑段條件。空段直接丟掉,因此 `tools/`、`/tools`、`//` 都與
 * `tools` 等價;`~` 段也丟掉 —— 它是顯示用的家目錄縮寫,不是使用者要找的名字。
 */
export function splitFilterQuery(query: string): string[] {
    return query.split("/").filter((part) => part !== "" && part !== "~");
}

/** 把縮寫後的路徑切成段;`~` 與空段不列入比對對象。 */
export function pathSegments(shownPath: string): string[] {
    return shownPath.split("/").filter((part) => part !== "" && part !== "~");
}

/**
 * subsequence 比對。`query` 必須是 `normalizeFilterQuery` 的輸出 (已小寫);
 * `target` 由本函式自行轉小寫,呼叫端不需預處理。空查詢一律命中。
 */
export function isSubsequenceMatch(query: string, target: string): boolean {
    if (query === "") {
        return true;
    }

    const haystack = target.toLowerCase();
    let matched = 0;
    for (const ch of haystack) {
        if (ch === query[matched]) {
            matched += 1;
            if (matched === query.length) {
                return true;
            }
        }
    }
    return false;
}

/**
 * 查詢的每一段是否能依序對上路徑的段。同一段內用 subsequence 比對,段之間只能
 * 往後推進 (`ai/sed` 不會命中 `sed/ai`),但允許跳過中間的段,因此
 * `pj/sup` 也能命中 `~/projects/platform/superset`。
 */
function matchesSegments(
    parts: readonly string[],
    segments: readonly string[]
): boolean {
    let cursor = 0;
    for (const part of parts) {
        const found = segments.findIndex(
            (segment, index) =>
                index >= cursor && isSubsequenceMatch(part, segment)
        );
        if (found === -1) {
            return false;
        }
        cursor = found + 1;
    }
    return true;
}

/**
 * 單一項目是否命中。比對對象是縮寫後路徑 (`~/projects/...`) 的`各段`,因為面板
 * 顯示的就是它;單段查詢額外允許比對顯示名稱,讓釘選項目可以用與路徑無關的
 * 自訂 label 找到。
 */
export function matchesCLIEntry(
    entry: CLIEntry,
    query: string,
    homeDir: string
): boolean {
    const parts = splitFilterQuery(query);
    if (parts.length === 0) {
        return true;
    }

    const segments = pathSegments(collapseHome(entry.path, homeDir));
    if (matchesSegments(parts, segments)) {
        return true;
    }

    return parts.length === 1 && isSubsequenceMatch(parts[0], entry.label);
}

/** 過濾釘選清單;順序維持原順序。 */
export function filterCLIEntries(
    entries: readonly CLIEntry[],
    query: string,
    homeDir: string
): CLIEntry[] {
    if (query === "") {
        return [...entries];
    }
    return entries.filter((entry) => matchesCLIEntry(entry, query, homeDir));
}

/**
 * 過濾掃描結果。第一層命中時整包子層一起留下 (命中的是父路徑,子層都在其下);
 * 第一層沒命中時只留下命中的子層,父節點仍保留以維持兩層樹形 —— 少了父節點,
 * 命中的第二層資料夾就沒有地方掛。父子皆未命中的整包丟棄。
 */
export function filterScannedFolders(
    folders: readonly ScannedFolder[],
    query: string,
    homeDir: string
): ScannedFolder[] {
    if (query === "") {
        return [...folders];
    }

    const kept: ScannedFolder[] = [];
    for (const folder of folders) {
        if (matchesCLIEntry(folder.entry, query, homeDir)) {
            kept.push({ entry: folder.entry, children: [...folder.children] });
            continue;
        }
        const children = folder.children.filter((child) =>
            matchesCLIEntry(child, query, homeDir)
        );
        if (children.length > 0) {
            kept.push({ entry: folder.entry, children });
        }
    }
    return kept;
}
