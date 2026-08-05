// CLI Launcher 路徑清單的純資料層 (pure data layer)。
//
// 這一層不依賴 `vscode`,只負責把使用者在 settings 裡填的
// `superset.cliLauncher.entries` 正規化成 tree view 可直接消費的
// `CLIEntry[]`:展開 `~`、補預設 label、去重、丟掉格式錯誤的項目。

import * as path from "node:path";

/** settings 內單一項目的物件寫法;字串簡寫 (只有路徑) 也允許。 */
export interface RawCLIEntry {
    label?: unknown;
    path?: unknown;
}

/** 正規化後的項目,tree view 與 terminal 啟動都只認這個型別。 */
export interface CLIEntry {
    /** 穩定識別 = 展開後的絕對路徑,同時作為去重 key。 */
    id: string;
    /** 顯示名稱,未指定時取路徑 basename。 */
    label: string;
    /** 展開 `~` 後的絕對路徑,terminal 的 cwd。 */
    path: string;
}

/**
 * 展開開頭的 `~`,並把相對路徑解析成絕對路徑。
 *
 * 只處理 `~` 與 `~/`,不支援 `~user` 形式 —— 那需要查 passwd,不是設定檔該做的事。
 */
export function expandHome(value: string, homeDir: string): string {
    const trimmed = value.trim();
    if (trimmed === "") {
        return "";
    }

    const expanded =
        trimmed === "~"
            ? homeDir
            : trimmed.startsWith("~/")
              ? path.join(homeDir, trimmed.slice(2))
              : trimmed;

    return path.resolve(expanded);
}

/** 把絕對路徑縮回 `~/...`,只用於顯示 (tooltip / description)。 */
export function collapseHome(value: string, homeDir: string): string {
    if (
        homeDir !== "" &&
        (value === homeDir || value.startsWith(`${homeDir}/`))
    ) {
        return `~${value.slice(homeDir.length)}`;
    }
    return value;
}

/**
 * 從 VS Code 命令參數還原 `CLIEntry`。
 *
 * 刻意用 duck typing 而不是 `instanceof CLIEntryTreeItem`:命令參數會跨過
 * VS Code 的 menu 層,任何 module 實體不同、序列化、或未來換成別的 tree item
 * 型別的情況,`instanceof` 都會靜默失敗成「按了沒反應」。這裡只要求形狀對。
 */
export function toCLIEntry(value: unknown): CLIEntry | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }

    const candidate = value as {
        entry?: unknown;
        path?: unknown;
        label?: unknown;
        resourceUri?: { fsPath?: unknown };
        fsPath?: unknown;
    };

    // tree item 會把正規化過的項目掛在 `.entry` 上。
    if (typeof candidate.entry === "object" && candidate.entry !== null) {
        const nested = toCLIEntry(candidate.entry);
        if (nested) {
            return nested;
        }
    }

    const target =
        typeof candidate.path === "string"
            ? candidate.path
            : typeof candidate.fsPath === "string"
              ? candidate.fsPath
              : typeof candidate.resourceUri?.fsPath === "string"
                ? candidate.resourceUri.fsPath
                : undefined;

    if (target === undefined || target.trim() === "") {
        return undefined;
    }

    const label =
        typeof candidate.label === "string" && candidate.label.trim() !== ""
            ? candidate.label.trim()
            : path.basename(target) || target;

    return { id: target, label, path: target };
}

/**
 * 把一批項目轉成「每行一個絕對路徑」的純文字,供 `Copy All Paths` 寫進剪貼簿。
 * 用絕對路徑 (不是 `collapseHome` 縮寫) 是因為貼上的目的地通常是另一個
 * shell 或設定檔,`~` 在那裡不一定會被展開。
 */
export function formatPathList(entries: readonly CLIEntry[]): string {
    return entries.map((entry) => entry.path).join("\n");
}

/**
 * 正規化掃描根目錄清單 (`superset.cliLauncher.roots`)。只收字串,展開 `~` 後
 * 去重,順序維持設定順序。
 */
export function normalizeRootPaths(raw: unknown, homeDir: string): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    const seen = new Set<string>();
    for (const item of raw) {
        if (typeof item !== "string") {
            continue;
        }
        const resolved = expandHome(item, homeDir);
        if (resolved !== "") {
            seen.add(resolved);
        }
    }
    return [...seen];
}

/**
 * 正規化「從面板移除」的路徑清單 (`superset.cliLauncher.hidden`)。形狀與
 * `roots` 相同:只收字串,展開 `~` 後去重。
 */
export function normalizeHiddenPaths(raw: unknown, homeDir: string): string[] {
    return normalizeRootPaths(raw, homeDir);
}

/**
 * `target` 是不是 `parent` 底下的子孫路徑 (不含 `parent` 自己)。
 *
 * 純字首比對:兩邊都已經是 `expandHome` 正規化過的絕對路徑,不需要再碰檔案系統。
 */
export function isDescendantPath(parent: string, target: string): boolean {
    return parent !== "" && target.startsWith(`${parent}/`);
}

/**
 * 這個路徑是不是被移除掉了。命中自己或任一祖先都算 —— 移掉
 * `~/projects/platform` 之後,它底下的第二層不該又從別的入口冒出來。
 */
export function isHiddenPath(
    target: string,
    hidden: readonly string[]
): boolean {
    return hidden.some(
        (value) => target === value || isDescendantPath(value, target)
    );
}

/**
 * 把路徑加進 raw hidden 陣列 (以 `~` 縮寫形式寫回設定)。已經在清單裡時回傳
 * `undefined`,呼叫端據此略過寫入。
 */
export function appendHiddenPath(
    raw: unknown,
    newPath: string,
    homeDir: string
): string[] | undefined {
    const resolved = expandHome(newPath, homeDir);
    if (resolved === "") {
        return undefined;
    }
    if (normalizeHiddenPaths(raw, homeDir).includes(resolved)) {
        return undefined;
    }

    const kept = Array.isArray(raw)
        ? raw.filter((item): item is string => typeof item === "string")
        : [];
    return [...kept, collapseHome(resolved, homeDir)];
}

/**
 * 從 raw hidden 陣列移除指定路徑 (以展開後路徑比對)。找不到時回傳 `undefined`,
 * 避免無謂地寫回設定。
 */
export function removeHiddenPath(
    raw: unknown,
    targetPath: string,
    homeDir: string
): string[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }

    const resolved = expandHome(targetPath, homeDir);
    if (!normalizeHiddenPaths(raw, homeDir).includes(resolved)) {
        return undefined;
    }
    return raw.filter(
        (item): item is string =>
            typeof item === "string" && expandHome(item, homeDir) !== resolved
    );
}

/**
 * 正規化 settings 陣列。無效項目 (非字串／非物件、路徑空白) 直接丟棄,
 * 相同路徑只保留第一筆,順序維持使用者設定的順序。
 */
export function normalizeEntries(raw: unknown, homeDir: string): CLIEntry[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    const seen = new Set<string>();
    const entries: CLIEntry[] = [];

    for (const item of raw) {
        const entry = normalizeEntry(item, homeDir);
        if (!entry || seen.has(entry.id)) {
            continue;
        }
        seen.add(entry.id);
        entries.push(entry);
    }

    return entries;
}

function normalizeEntry(item: unknown, homeDir: string): CLIEntry | undefined {
    const raw: RawCLIEntry =
        typeof item === "string"
            ? { path: item }
            : typeof item === "object" && item !== null
              ? (item as RawCLIEntry)
              : {};

    if (typeof raw.path !== "string") {
        return undefined;
    }

    const resolved = expandHome(raw.path, homeDir);
    if (resolved === "") {
        return undefined;
    }

    const label =
        typeof raw.label === "string" && raw.label.trim() !== ""
            ? raw.label.trim()
            : path.basename(resolved) || resolved;

    return { id: resolved, label, path: resolved };
}

/**
 * 把新路徑追加到既有的 raw settings 陣列。已存在 (展開後同路徑) 時回傳
 * `undefined`,呼叫端據此顯示「已存在」訊息而不是重複寫入設定。
 */
export function appendEntryPath(
    raw: unknown,
    newPath: string,
    homeDir: string
): RawCLIEntry[] | undefined {
    const resolved = expandHome(newPath, homeDir);
    if (resolved === "") {
        return undefined;
    }

    const existing = normalizeEntries(raw, homeDir);
    if (existing.some((entry) => entry.id === resolved)) {
        return undefined;
    }

    const kept = Array.isArray(raw) ? raw : [];
    return [
        ...(kept as RawCLIEntry[]),
        { path: collapseHome(resolved, homeDir) },
    ];
}

/**
 * 從 raw settings 陣列移除指定項目 (以展開後路徑比對)。
 * 找不到對應項目時回傳 `undefined`,避免無謂地寫回設定。
 */
export function removeEntryPath(
    raw: unknown,
    targetPath: string,
    homeDir: string
): RawCLIEntry[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }

    const resolved = expandHome(targetPath, homeDir);
    const kept = raw.filter((item) => {
        const entry = normalizeEntry(item, homeDir);
        return entry?.id !== resolved;
    });

    return kept.length === raw.length ? undefined : (kept as RawCLIEntry[]);
}
