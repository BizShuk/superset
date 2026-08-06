// CLI Launcher Focus list 的 pure data boundary。
//
// Focus 是 exact path selection，不是另一套 Regex 或 traversal 規則。這裡只處理
// settings normalization 與既有兩層 catalog 的 projection，不依賴 `vscode`。

import type { CatalogEntry } from "./catalog";
import { collapseHome, expandHome } from "./entries";
import type { ScannedFolder } from "./scan";

interface FocusedSettingPath {
    readonly raw: string;
    readonly path: string;
}

export interface FocusedPathProjection {
    readonly entries: CatalogEntry[];
    readonly folders: ScannedFolder[];
}

function normalizedSettingPaths(
    raw: unknown,
    homeDir: string
): FocusedSettingPath[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    const seen = new Set<string>();
    const paths: FocusedSettingPath[] = [];
    for (const item of raw) {
        if (typeof item !== "string") {
            continue;
        }
        const resolved = expandHome(item, homeDir);
        if (resolved === "" || seen.has(resolved)) {
            continue;
        }
        seen.add(resolved);
        paths.push({ raw: item, path: resolved });
    }
    return paths;
}

/** 讀取 exact literal Focus paths，維持 settings 順序並去重。 */
export function normalizeFocusedPaths(
    raw: unknown,
    homeDir: string
): string[] {
    return normalizedSettingPaths(raw, homeDir).map(({ path }) => path);
}

/** 追加 Focus path；已存在或 path 無效時不產生 settings write。 */
export function appendFocusedPath(
    raw: unknown,
    targetPath: string,
    homeDir: string
): string[] | undefined {
    const resolved = expandHome(targetPath, homeDir);
    if (resolved === "") {
        return undefined;
    }

    const paths = normalizedSettingPaths(raw, homeDir);
    if (paths.some(({ path }) => path === resolved)) {
        return undefined;
    }
    return [
        ...paths.map(({ raw: item }) => item),
        collapseHome(resolved, homeDir),
    ];
}

/** 移除 Focus path；找不到時不產生 settings write。 */
export function removeFocusedPath(
    raw: unknown,
    targetPath: string,
    homeDir: string
): string[] | undefined {
    const resolved = expandHome(targetPath, homeDir);
    const paths = normalizedSettingPaths(raw, homeDir);
    if (!paths.some(({ path }) => path === resolved)) {
        return undefined;
    }
    return paths
        .filter(({ path }) => path !== resolved)
        .map(({ raw: item }) => item);
}

/**
 * Focus-only mode 保留 exact Focused paths。Focused child 的第一層 ancestor 只作為
 * navigation container 保留；聚焦第一層本身不會隱含聚焦其 children。
 */
export function projectFocusedPaths(
    entries: readonly CatalogEntry[],
    folders: readonly ScannedFolder[],
    focusedPaths: readonly string[],
    focusedOnly: boolean
): FocusedPathProjection {
    if (!focusedOnly) {
        return { entries: [...entries], folders: [...folders] };
    }

    const focused = new Set(focusedPaths);
    return {
        entries: entries.filter(({ entry }) => focused.has(entry.path)),
        folders: folders.flatMap((folder) => {
            const children = folder.children.filter((child) =>
                focused.has(child.path)
            );
            return focused.has(folder.entry.path) || children.length > 0
                ? [{ entry: folder.entry, children }]
                : [];
        }),
    };
}
