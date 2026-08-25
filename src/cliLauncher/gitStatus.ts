// CLI Launcher 每一列右側顯示的 git 狀態:目前分支、與 upstream 差幾個 commit,
// 以及待處理的行數增減。
//
// 面板的 description 欄原本重複顯示路徑 (label 已經是 basename),資訊量低;改成
// `<branch>(+<新增行>,-<刪除行>)`,挑 cwd 時一眼看得出來在哪個分支、手上還有多少
// 沒收的改動。停在預設分支 (`master` / `main`) 且零改動時 description 留空 ——
// 那是常態,一整排 `master(+0,-0)` 只會把真正在動的 repo 淹掉;tooltip 仍給完整值。
//
// 領先／落後的 commit 數讀的是`本地已有的` remote-tracking refs,因此每次刷新都
// 能算而不必連網;真正去抓遠端的 `fetchGitFolders` 只在使用者按 `Refresh` 時跑。
//
// 只有`資料夾自己`是 repository (含 submodule / worktree 的 `.git` 檔) 才會執行
// git。刻意不讓 git 沿著父層往上找:`~/projects/platform` 不是 repo 時若往上找會
// 顯示 `~/projects` 甚至 `~` 的狀態,那是張冠李戴。
//
// 這一層不依賴 `vscode`;解析與格式化是純函式,可直接對字串測試。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hasOwnGitMarker } from "./repositoryDiscovery";

const execFileAsync = promisify(execFile);

/** 單一資料夾的 git 摘要。 */
export interface GitFolderStatus {
    /** 目前分支名;detached HEAD 時是短 commit hash。 */
    branch: string;
    /** 相對於 `HEAD` 的新增／修改行數 (staged + unstaged)。 */
    added: number;
    /** 相對於 `HEAD` 的刪除行數 (staged + unstaged)。 */
    removed: number;
    /** 本地有、upstream 沒有的 commit 數;沒有 upstream 時是 0。 */
    ahead: number;
    /** upstream 有、本地沒有的 commit 數;沒有 upstream 時是 0。 */
    behind: number;
}

/** 同時處理的資料夾數上限;一次掃描可能有數十列,不能全部一起 spawn。 */
const MAX_CONCURRENCY = 8;

/**
 * 同時進行的 `git fetch` 數上限。fetch 走網路 (多半是 SSH),併發拉高只會一起
 * 卡在連線上,還可能觸發遠端的併發限制,因此比本地查詢保守。
 */
const FETCH_CONCURRENCY = 4;

/** 單一 git 命令的逾時 (毫秒);超時視為沒有 git 資訊,不擋住整個面板。 */
const GIT_TIMEOUT_MS = 3000;

/** `git fetch` 的逾時 (毫秒);走網路,不能沿用本地查詢的 3 秒。 */
const GIT_FETCH_TIMEOUT_MS = 20_000;

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

/** 本地領先／落後 upstream 的 commit 數;`parseAheadBehind` 的回傳形狀。 */
export interface CommitDivergence {
    ahead: number;
    behind: number;
}

/**
 * 解析 `git rev-list --count --left-right <upstream>...HEAD` 的輸出:
 * 單行 `<左邊獨有>\t<右邊獨有>`,左邊是 upstream (落後數),右邊是 HEAD (領先數)。
 *
 * 沒有 upstream、尚無 commit 或輸出不成形時一律回傳 0/0 —— 這是裝飾資訊,
 * 「不知道」與「同步中」在畫面上都是不顯示。
 */
export function parseAheadBehind(
    output: string | undefined
): CommitDivergence {
    const [behindText, aheadText] = (output ?? "").trim().split(/\s+/);
    const behind = Number.parseInt(behindText ?? "", 10);
    const ahead = Number.parseInt(aheadText ?? "", 10);
    return {
        ahead: Number.isNaN(ahead) ? 0 : ahead,
        behind: Number.isNaN(behind) ? 0 : behind,
    };
}

/**
 * 預設分支名;停在預設分支且沒有改動是「沒事發生」的常態,不值得佔用 description。
 */
const DEFAULT_BRANCHES = new Set(["master", "main"]);

/**
 * 與 upstream 的差距 `↑<領先>↓<落後>`;為 0 的那一邊直接省略,兩邊都 0 時是空字串。
 *
 * 領先／落後只有`不為零`時才是資訊 —— 一整排 `↑0↓0` 等同雜訊,而且這一列還要
 * 塞分支名與行數增減,橫向空間本來就不夠。
 */
function formatDivergence(status: GitFolderStatus): string {
    const ahead = status.ahead > 0 ? `↑${status.ahead}` : "";
    const behind = status.behind > 0 ? `↓${status.behind}` : "";
    return `${ahead}${behind}`;
}

/**
 * 格式化成完整字串 `<branch><↑領先><↓落後>(+<新增>,-<刪除>)`。
 *
 * 沒有 git 資訊 (不是 repository、讀取失敗) 時回傳空字串。乾淨的 repo 仍然顯示
 * `master(+0,-0)` —— 這是 tooltip 用的完整形式,分支名本身就是有用資訊。
 * 領先／落後只在不為零時出現;它跟著分支放在前面,因為兩者講的是同一件事:
 * 這個 repo 現在停在哪、跟遠端差多少。
 */
export function formatGitFolderStatus(
    status: GitFolderStatus | undefined
): string {
    if (!status || status.branch === "") {
        return "";
    }
    const divergence = formatDivergence(status);
    return `${status.branch}${divergence}(+${status.added},-${status.removed})`;
}

/**
 * 這個資料夾是不是「預設分支 + 零改動 + 與 upstream 同步」的靜止狀態。
 *
 * 只有這一種組合會從 description 隱藏;`w-*` 分支即使乾淨仍要顯示,因為
 * 「現在站在哪個 worktree 分支」本身就是要挑 cwd 的人在找的資訊。有未推送或
 * 未拉取的 commit 也一律顯示 —— 那正是 `Refresh` 抓完遠端後要看的東西。
 */
export function isQuietGitFolderStatus(
    status: GitFolderStatus | undefined
): boolean {
    return (
        status !== undefined &&
        status.added === 0 &&
        status.removed === 0 &&
        status.ahead === 0 &&
        status.behind === 0 &&
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

/**
 * 執行單一 git 命令並回傳 stdout;任何失敗回傳 `undefined`。
 *
 * `--no-optional-locks` 避免只是要顯示數字卻去寫使用者的 index lock。
 */
async function runGit(
    dir: string,
    args: readonly string[],
    timeoutMs: number = GIT_TIMEOUT_MS
): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync(
            "git",
            ["--no-optional-locks", ...args],
            {
                cwd: dir,
                encoding: "utf8",
                timeout: timeoutMs,
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
 *
 * `--ignore-submodules=all` 排除 gitlink:submodule 指標更新在 numstat 是
 * `1\t1\t<path>`,但 parent repo 裡`沒有任何一行檔案內容`改變,計入會讓
 * 一個只是 pin 前進的 workspace 看起來有一堆待處理的編輯。submodule 自己的
 * 改動由它自己那一列顯示。
 */
const DIFF_ARGS = ["--numstat", "--ignore-submodules=all"];

/**
 * 相對於 upstream 的 commit 數差距。`--left-right` 讓一次 `rev-list` 同時給出
 * 兩邊,不必分開跑兩個 `--count`。
 *
 * 沒有設定 upstream (例如本地新分支) 時 `@{upstream}` 解析失敗,`runGit` 回
 * `undefined`,直接落到 0/0。這是純本地查詢,讀的是上次 fetch 留下的 remote ref,
 * 因此每次刷新都能算,不必等網路。
 */
async function readAheadBehind(dir: string): Promise<CommitDivergence> {
    return parseAheadBehind(
        await runGit(dir, [
            "rev-list",
            "--count",
            "--left-right",
            "@{upstream}...HEAD",
        ])
    );
}

async function readDiffLines(dir: string): Promise<DiffLineCounts> {
    const output =
        (await runGit(dir, ["diff", "HEAD", ...DIFF_ARGS])) ??
        (await runGit(dir, ["diff", ...DIFF_ARGS]));
    return output === undefined ? { added: 0, removed: 0 } : parseNumstat(output);
}

/**
 * 讀取單一資料夾的 git 摘要。任何失敗 (不是 repo、git 不存在、逾時、輸出過大)
 * 一律回傳 `undefined` —— 這是面板的裝飾資訊,不該讓一個壞掉的路徑變成錯誤畫面。
 */
export async function readGitFolderStatus(
    dir: string
): Promise<GitFolderStatus | undefined> {
    if (!(await hasOwnGitMarker(dir))) {
        return undefined;
    }

    // 三個查詢彼此沒有先後關係,一起發出;逐個 await 會讓每一列的成本加倍。
    const [branch, lines, divergence] = await Promise.all([
        readBranch(dir),
        readDiffLines(dir),
        readAheadBehind(dir),
    ]);
    if (branch === undefined) {
        return undefined;
    }

    return {
        branch,
        added: lines.added,
        removed: lines.removed,
        ahead: divergence.ahead,
        behind: divergence.behind,
    };
}

/**
 * 以固定併發數依序處理每個項目。
 */
async function forEachWithConcurrency<T>(
    items: readonly T[],
    limit: number,
    handle: (item: T) => Promise<void>
): Promise<void> {
    let cursor = 0;

    async function worker(): Promise<void> {
        while (cursor < items.length) {
            const item = items[cursor];
            cursor += 1;
            await handle(item);
        }
    }

    const workers = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
}

/**
 * 更新這些資料夾的 remote-tracking refs (`git fetch`),讓之後讀到的領先／落後
 * 數字反映遠端`現在`的狀態。
 *
 * 只在使用者按下 `Refresh` 時呼叫:fetch 會走網路與認證,不能掛在每 5 分鐘的
 * 自動刷新上 —— 那等於替每個開著面板的人固定對所有遠端發流量。
 *
 * 不是 repository 的路徑直接跳過;任何失敗 (沒有 remote、離線、認證失敗、逾時)
 * 都當成「這次沒抓到」而安靜略過,面板仍顯示上一次已知的狀態。
 */
export async function fetchGitFolders(dirs: readonly string[]): Promise<void> {
    const unique = [...new Set(dirs)];
    await forEachWithConcurrency(unique, FETCH_CONCURRENCY, async (dir) => {
        if (!(await hasOwnGitMarker(dir))) {
            return;
        }
        // `--no-tags` 讓 fetch 只更新這個 remote 的 branch refs;面板要的是分支
        // 的領先／落後,tag 對這個數字沒有貢獻,卻是大 repo 最貴的那一段。
        await runGit(
            dir,
            ["fetch", "--quiet", "--no-tags"],
            GIT_FETCH_TIMEOUT_MS
        );
    });
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

    await forEachWithConcurrency(unique, MAX_CONCURRENCY, async (dir) => {
        const status = await readGitFolderStatus(dir);
        if (status) {
            found.set(dir, status);
        }
    });

    return found;
}
