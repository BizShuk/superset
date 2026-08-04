// CLI Launcher 每一列右側顯示的 git 狀態:目前分支與待處理的行數增減。
//
// 面板的 description 欄原本重複顯示路徑 (label 已經是 basename),資訊量低;改成
// `<branch>(+<新增行>,-<刪除行>)`,挑 cwd 時一眼看得出來在哪個分支、手上還有多少
// 沒收的改動。停在預設分支 (`master` / `main`) 且零改動時 description 留空 ——
// 那是常態,一整排 `master(+0,-0)` 只會把真正在動的 repo 淹掉;tooltip 仍給完整值。
//
// 只有`資料夾自己`是 repository (含 submodule / worktree 的 `.git` 檔) 才會執行
// git。刻意不讓 git 沿著父層往上找:`~/projects/platform` 不是 repo 時若往上找會
// 顯示 `~/projects` 甚至 `~` 的狀態,那是張冠李戴。
//
// 這一層不依賴 `vscode`;解析與格式化是純函式,可直接對字串測試。

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 單一資料夾的 git 摘要。 */
export interface GitFolderStatus {
    /** 目前分支名;detached HEAD 時是短 commit hash。 */
    branch: string;
    /** 相對於 `HEAD` 的新增／修改行數 (staged + unstaged)。 */
    added: number;
    /** 相對於 `HEAD` 的刪除行數 (staged + unstaged)。 */
    removed: number;
}

/** 同時處理的資料夾數上限;一次掃描可能有數十列,不能全部一起 spawn。 */
const MAX_CONCURRENCY = 8;

/** 單一 git 命令的逾時 (毫秒);超時視為沒有 git 資訊,不擋住整個面板。 */
const GIT_TIMEOUT_MS = 3000;

/** stdout 上限;超出代表這個 repo 大到不適合逐列顯示,直接放棄。 */
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

/** 行數增減;`parseNumstat` 的回傳形狀。 */
export interface DiffLineCounts {
    added: number;
    removed: number;
}

/**
 * 解析 `git diff --numstat` 的輸出:每行是 `<新增>\t<刪除>\t<路徑>`。
 *
 * 二進位檔案的兩欄是 `-`,沒有行的概念,直接略過而不是當成 0 ——
 * 兩者在總和上等價,但略過的意圖比較清楚。
 */
export function parseNumstat(output: string): DiffLineCounts {
    const counts: DiffLineCounts = { added: 0, removed: 0 };

    for (const line of output.split("\n")) {
        const [addedText, removedText] = line.split("\t");
        if (addedText === undefined || removedText === undefined) {
            continue;
        }
        const added = Number.parseInt(addedText, 10);
        const removed = Number.parseInt(removedText, 10);
        if (Number.isNaN(added) || Number.isNaN(removed)) {
            continue;
        }
        counts.added += added;
        counts.removed += removed;
    }

    return counts;
}

/**
 * 預設分支名;停在預設分支且沒有改動是「沒事發生」的常態,不值得佔用 description。
 */
const DEFAULT_BRANCHES = new Set(["master", "main"]);

/**
 * 格式化成完整字串 `<branch>(+<新增>,-<刪除>)`。
 *
 * 沒有 git 資訊 (不是 repository、讀取失敗) 時回傳空字串。乾淨的 repo 仍然顯示
 * `master(+0,-0)` —— 這是 tooltip 用的完整形式,分支名本身就是有用資訊。
 */
export function formatGitFolderStatus(
    status: GitFolderStatus | undefined
): string {
    if (!status || status.branch === "") {
        return "";
    }
    return `${status.branch}(+${status.added},-${status.removed})`;
}

/**
 * 這個資料夾是不是「預設分支 + 零改動」的靜止狀態。
 *
 * 只有這一種組合會從 description 隱藏;`w-*` 分支即使乾淨仍要顯示,因為
 * 「現在站在哪個 worktree 分支」本身就是要挑 cwd 的人在找的資訊。
 */
export function isQuietGitFolderStatus(
    status: GitFolderStatus | undefined
): boolean {
    return (
        status !== undefined &&
        status.added === 0 &&
        status.removed === 0 &&
        DEFAULT_BRANCHES.has(status.branch)
    );
}

/**
 * 格式化成面板 description 用的字串。與 `formatGitFolderStatus` 的差別只有一個:
 * 靜止狀態 (預設分支 + 零改動) 回傳空字串,讓一整排沒在動的 repo 不佔版面;
 * 完整資訊仍留在 tooltip。
 */
export function formatGitFolderDescription(
    status: GitFolderStatus | undefined
): string {
    return isQuietGitFolderStatus(status) ? "" : formatGitFolderStatus(status);
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
 * 執行單一 git 命令並回傳 stdout;任何失敗回傳 `undefined`。
 *
 * `--no-optional-locks` 避免只是要顯示數字卻去寫使用者的 index lock。
 */
async function runGit(
    dir: string,
    args: readonly string[]
): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync(
            "git",
            ["--no-optional-locks", ...args],
            {
                cwd: dir,
                encoding: "utf8",
                timeout: GIT_TIMEOUT_MS,
                maxBuffer: GIT_MAX_BUFFER,
            }
        );
        return stdout;
    } catch {
        return undefined;
    }
}

/**
 * 目前分支名。detached HEAD 時 `--show-current` 是空字串,退回短 commit hash;
 * 兩者都拿不到 (例如尚無 commit 的空 repo) 時回傳 `undefined`。
 */
async function readBranch(dir: string): Promise<string | undefined> {
    const current = (await runGit(dir, ["branch", "--show-current"]))?.trim();
    if (current !== undefined && current !== "") {
        return current;
    }
    const head = (await runGit(dir, ["rev-parse", "--short", "HEAD"]))?.trim();
    return head === "" ? undefined : head;
}

/**
 * 相對於 `HEAD` 的行數增減,涵蓋 staged 與 unstaged —— 面板要的是「手上還有多少
 * 沒收的改動」,分兩欄反而看不出總量。
 *
 * 未追蹤檔案不在 `git diff` 的範圍內,因此`不計入`;要看未追蹤請開 SCM 面板。
 * 尚無 commit 的 repo 沒有 `HEAD`,退回只比對工作區與 index。
 */
async function readDiffLines(dir: string): Promise<DiffLineCounts> {
    const output =
        (await runGit(dir, ["diff", "HEAD", "--numstat"])) ??
        (await runGit(dir, ["diff", "--numstat"]));
    return output === undefined ? { added: 0, removed: 0 } : parseNumstat(output);
}

/**
 * 讀取單一資料夾的 git 摘要。任何失敗 (不是 repo、git 不存在、逾時、輸出過大)
 * 一律回傳 `undefined` —— 這是面板的裝飾資訊,不該讓一個壞掉的路徑變成錯誤畫面。
 */
export async function readGitFolderStatus(
    dir: string
): Promise<GitFolderStatus | undefined> {
    if (!(await hasGitDirectory(dir))) {
        return undefined;
    }

    // 分支與 diff 沒有先後關係,一起發出;逐個 await 會讓每一列的成本加倍。
    const [branch, lines] = await Promise.all([
        readBranch(dir),
        readDiffLines(dir),
    ]);
    if (branch === undefined) {
        return undefined;
    }

    return { branch, added: lines.added, removed: lines.removed };
}

/**
 * 批次讀取,並限制同時處理的資料夾數。回傳的 map 只收有結果的路徑,
 * 呼叫端拿到 `undefined` 就等於「這一列沒有 git 資訊」。
 */
export async function readGitFolderStatusMap(
    dirs: readonly string[]
): Promise<Map<string, GitFolderStatus>> {
    const unique = [...new Set(dirs)];
    const found = new Map<string, GitFolderStatus>();
    let cursor = 0;

    async function worker(): Promise<void> {
        while (cursor < unique.length) {
            const dir = unique[cursor];
            cursor += 1;
            const status = await readGitFolderStatus(dir);
            if (status) {
                found.set(dir, status);
            }
        }
    }

    const workers = Math.min(MAX_CONCURRENCY, unique.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return found;
}
