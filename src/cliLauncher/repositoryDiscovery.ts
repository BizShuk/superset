// CLI Launcher 預設 rows 的 Git repository discovery boundary。
//
// Raw scanner 刻意保留所有兩層 directory candidates，讓 explicit literal / Regex
// entries 可以選取非 repository。Catalog resolution 完成後，才由這裡把剩餘的
// ordinary scan rows 投影成 Git-only tree。

import { stat } from "node:fs/promises";
import * as path from "node:path";
import type { ScannedFolder } from "./scan";

/** 同時 probe 的 folder 上限；大量兩層 candidates 不得一次打滿 filesystem。 */
const MAX_CONCURRENCY = 8;

export type RepositoryProbe = (dir: string) => Promise<boolean>;

/**
 * 資料夾自己是否帶有 `.git` marker。
 *
 * `.git` 可以是一般 repository 的 directory，也可以是 worktree / submodule 的
 * file。任何讀取失敗都視為不是 repository；不沿 parent directory 往上尋找。
 */
export async function hasOwnGitMarker(dir: string): Promise<boolean> {
    try {
        const marker = await stat(path.join(dir, ".git"));
        return marker.isDirectory() || marker.isFile();
    } catch {
        return false;
    }
}

async function findRepositoryPaths(
    folders: readonly ScannedFolder[],
    probe: RepositoryProbe
): Promise<Set<string>> {
    const candidates = [
        ...new Set(
            folders.flatMap((folder) => [
                folder.entry.path,
                ...folder.children.map((child) => child.path),
            ])
        ),
    ];
    const repositories = new Set<string>();
    let cursor = 0;

    async function worker(): Promise<void> {
        while (cursor < candidates.length) {
            const candidate = candidates[cursor];
            cursor += 1;
            try {
                if (await probe(candidate)) {
                    repositories.add(candidate);
                }
            } catch {
                // Discovery 是 fail-soft UI boundary；單一路徑失敗不可中止整棵樹。
            }
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(MAX_CONCURRENCY, candidates.length) },
            () => worker()
        )
    );
    return repositories;
}

/**
 * 只保留 Git repositories。第一層非 repository 若有 repository children，仍作為
 * category container 保留；沒有可見 repository child 的非 repository 則省略。
 */
export async function filterRepositoryFolders(
    folders: readonly ScannedFolder[],
    probe: RepositoryProbe = hasOwnGitMarker
): Promise<ScannedFolder[]> {
    const repositories = await findRepositoryPaths(folders, probe);

    return folders.flatMap((folder) => {
        const children = folder.children.filter((child) =>
            repositories.has(child.path)
        );
        if (!repositories.has(folder.entry.path) && children.length === 0) {
            return [];
        }
        return [{ entry: folder.entry, children }];
    });
}
