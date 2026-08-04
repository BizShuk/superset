// CLI Launcher 每一列右側顯示的 git pending 計數。
//
// 面板的 description 欄原本重複顯示路徑 (label 已經是 basename、tooltip 也有完整
// 路徑),資訊量低;改成顯示該資料夾的 git 待處理檔案數,挑 cwd 時才看得出來
// 哪個 repo 還有東西沒收。
//
// 只有`資料夾自己`是 repository (含 submodule / worktree 的 `.git` 檔) 才會執行
// git。刻意不讓 git 沿著父層往上找:`~/projects/platform` 不是 repo,若往上找會
// 顯示 `~/projects` 甚至 `~` 的狀態,那是張冠李戴。
//
// 這一層不依賴 `vscode`;解析與格式化是純函式,可直接對字串測試。

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 單一資料夾的待處理檔案數。 */
export interface GitPendingCounts {
    /** 已 `git add` 進 index 的變更數 (porcelain 的 X 欄)。 */
    staged: number;
    /** 已追蹤但未 `git add` 的變更數 (porcelain 的 Y 欄)。 */
    unstaged: number;
    /** 未追蹤項目數 (`??`);未追蹤資料夾以整包一筆計。 */
    untracked: number;
}

/** 同時執行的 `git status` 上限;一次掃描可能有數十列,不能全部一起 spawn。 */
const MAX_CONCURRENCY = 8;

/** 單一 `git status` 的逾時 (毫秒);超時視為沒有 git 資訊,不擋住整個面板。 */
const STATUS_TIMEOUT_MS = 3000;

/** stdout 上限;超出代表這個 repo 大到不適合逐列顯示,直接放棄。 */
const STATUS_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * 解析 `git status --porcelain=v1` 的輸出。
 *
 * 每行前兩個字元是 `XY`:`X` 是 index 狀態、`Y` 是工作區狀態,空白代表該側沒有
 * 變更。`??` 是未追蹤、`!!` 是被忽略 (預設不會出現)。unmerged (`UU`、`AA` …)
 * 兩側都是字母,因此同時計入 staged 與 unstaged —— 它確實兩邊都待處理。
 */
export function parseGitStatus(output: string): GitPendingCounts {
    const counts: GitPendingCounts = { staged: 0, unstaged: 0, untracked: 0 };

    for (const line of output.split("\n")) {
        if (line.length < 2) {
            continue;
        }
        const index = line[0];
        const worktree = line[1];

        if (index === "?" && worktree === "?") {
            counts.untracked += 1;
            continue;
        }
        if (index === "!" && worktree === "!") {
            continue;
        }
        if (index !== " ") {
            counts.staged += 1;
        }
        if (worktree !== " ") {
            counts.unstaged += 1;
        }
    }

    return counts;
}

/**
 * 格式化成 description 字串 `staged:<n> unstaged:<n> <untracked>`。
 *
 * 沒有 git 資訊 (不是 repository、讀取失敗) 或完全乾淨時回傳空字串:面板一列一
 * 個 repo,把幾十個 `staged:0 unstaged:0 0` 全部畫出來只是噪音。
 */
export function formatGitPendingCounts(
    counts: GitPendingCounts | undefined
): string {
    if (!counts) {
        return "";
    }
    const { staged, unstaged, untracked } = counts;
    if (staged === 0 && unstaged === 0 && untracked === 0) {
        return "";
    }
    return `staged:${staged} unstaged:${unstaged} ${untracked}`;
}

/** 資料夾自己是不是 repository。`.git` 可能是目錄,也可能是 submodule 的檔案。 */
async function hasGitDirectory(dir: string): Promise<boolean> {
    try {
        await stat(path.join(dir, ".git"));
        return true;
    } catch {
        return false;
    }
}

/**
 * 讀取單一資料夾的待處理檔案數。任何失敗 (不是 repo、git 不存在、逾時、輸出過大)
 * 一律回傳 `undefined` —— 這是面板的裝飾資訊,不該讓一個壞掉的路徑變成錯誤畫面。
 *
 * `--no-optional-locks` 避免只是要顯示數字卻去寫使用者的 index lock;
 * 未追蹤項目用 git 預設的 `normal`,整包未追蹤資料夾算一筆,不逐檔展開。
 */
export async function readGitPendingCounts(
    dir: string
): Promise<GitPendingCounts | undefined> {
    if (!(await hasGitDirectory(dir))) {
        return undefined;
    }

    try {
        const { stdout } = await execFileAsync(
            "git",
            ["--no-optional-locks", "status", "--porcelain=v1"],
            {
                cwd: dir,
                encoding: "utf8",
                timeout: STATUS_TIMEOUT_MS,
                maxBuffer: STATUS_MAX_BUFFER,
            }
        );
        return parseGitStatus(stdout);
    } catch {
        return undefined;
    }
}

/**
 * 批次讀取,並限制同時執行的 git 行程數。回傳的 map 只收有結果的路徑,
 * 呼叫端拿到 `undefined` 就等於「這一列沒有 git 資訊」。
 */
export async function readGitPendingCountsMap(
    dirs: readonly string[]
): Promise<Map<string, GitPendingCounts>> {
    const unique = [...new Set(dirs)];
    const found = new Map<string, GitPendingCounts>();
    let cursor = 0;

    async function worker(): Promise<void> {
        while (cursor < unique.length) {
            const dir = unique[cursor];
            cursor += 1;
            const counts = await readGitPendingCounts(dir);
            if (counts) {
                found.set(dir, counts);
            }
        }
    }

    const workers = Math.min(MAX_CONCURRENCY, unique.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return found;
}
