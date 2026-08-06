// CLI Launcher settings 與兩層 scan result 的 pure catalog resolution。
//
// 這裡集中 Dynamic Entry expansion、literal precedence、hidden filtering 與去重，
// 確保 Tree View、Quick Pick、Copy All Paths 消費相同的 path catalog。

import {
    collapseHome,
    isHiddenPath,
    type CLIEntry,
    type EntrySelector,
    type HiddenRule,
} from "./entries";
import { isPathRegex, matchesPathRegex } from "./pathPattern";
import type { ScannedFolder } from "./scan";

export interface CatalogEntry {
    readonly source: "literal" | "regex";
    readonly entry: CLIEntry;
}

export interface CLILauncherCatalog {
    readonly entries: CatalogEntry[];
    readonly folders: ScannedFolder[];
}

/**
 * Regex entries 只對既有兩層 scan candidates 展開；literal entry 不依賴 scan。
 * explicit literal 在任何設定位置都優先於命中同一路徑的 Regex selector。
 */
export function buildCLILauncherCatalog(
    selectors: readonly EntrySelector[],
    scanned: readonly ScannedFolder[],
    hidden: readonly HiddenRule[],
    homeDir: string
): CLILauncherCatalog {
    const candidates = scanned.flatMap((folder) => [
        folder.entry,
        ...folder.children,
    ]);
    const literalPaths = new Set(
        selectors
            .filter((selector) => !isPathRegex(selector))
            .map((selector) => selector.entry.path)
    );
    const seen = new Set<string>();
    const resolved: CatalogEntry[] = [];

    for (const selector of selectors) {
        if (!isPathRegex(selector)) {
            if (!seen.has(selector.entry.path)) {
                seen.add(selector.entry.path);
                resolved.push({ source: "literal", entry: selector.entry });
            }
            continue;
        }

        for (const candidate of candidates) {
            if (
                seen.has(candidate.path) ||
                literalPaths.has(candidate.path) ||
                !matchesPathRegex(selector, [
                    candidate.path,
                    collapseHome(candidate.path, homeDir),
                ])
            ) {
                continue;
            }
            seen.add(candidate.path);
            resolved.push({ source: "regex", entry: candidate });
        }
    }

    const entries = resolved.filter(
        ({ source, entry }) =>
            source === "literal" ||
            !isHiddenPath(entry.path, hidden, homeDir)
    );
    const selectedPaths = new Set(entries.map(({ entry }) => entry.path));
    const folders = scanned
        .filter(
            (folder) =>
                !selectedPaths.has(folder.entry.path) &&
                !isHiddenPath(folder.entry.path, hidden, homeDir)
        )
        .map((folder) => ({
            entry: folder.entry,
            children: folder.children.filter(
                (child) =>
                    !selectedPaths.has(child.path) &&
                    !isHiddenPath(child.path, hidden, homeDir)
            ),
        }));

    return { entries, folders };
}
