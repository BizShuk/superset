# CLI Launcher：移除面板路徑、隱藏靜止 git 狀態與定期重刷

2026-08-04。已實作。延續
[`2026-08-04-cli-launcher-git-branch-line-counts.md`](2026-08-04-cli-launcher-git-branch-line-counts.md)
與 [`2026-08-04-cli-launcher-path-terminals.md`](2026-08-04-cli-launcher-path-terminals.md)。

## 問題 (Problem)

1. 面板每一列都掛著 git 摘要，但實務上多數 repo 停在 `master` 且沒有改動，於是
   整個面板變成一整排 `master(+0,-0)`，真正在動的分支反而被淹掉。
2. tooltip 同時放了 label、完整路徑、terminal 數、git 說明與一句操作提示，資訊密度
   高但沒有一項是 hover 時真的在找的。
3. 掃描深度固定兩層、root 預設 `~/projects`，一定會撈到不想在清單裡看到的資料夾
   （下載目錄、暫時 clone、非專案的雜物）。先前只有`釘選`的列能移除，掃描出來的列
   只能改 `superset.cliLauncher.roots`，等於要為了一個資料夾放棄整個 root。

## 決策 (Decisions)

### description 隱藏靜止狀態

`gitStatus.ts` 分成兩個格式化函式，判斷只有一處：

- `formatGitFolderStatus` —— 完整形式 `<branch>(+<added>,-<removed>)`，tooltip 用。
- `formatGitFolderDescription` —— description 用；`isQuietGitFolderStatus`
  （分支屬於 `master` / `main` 且 `added === removed === 0`）成立時回傳空字串。

只隱藏這一種組合。乾淨的 `w-*` 分支仍然顯示 —— 「現在站在哪個 worktree 分支」正是
挑 cwd 的人在找的資訊，跟「沒事發生」不同。非 repository 與讀取失敗維持原本的空白。

### tooltip 只留 git 與 terminal 數

tooltip 收斂成兩行：完整 git 摘要（含 description 省略掉的靜止狀態）與
`CLI terminals: <count>`。label 已經是列名、操作提示屬於 README，重複放進 hover
沒有讓任何決定變快。完整路徑也一併移除；兩層樹的父列即是上一層目錄，路徑本身可從
樹形讀出。

### 每一列都能移除

`superset.cliLauncherRemovePath`（標題改為 `Remove from Panel`）同時服務兩種列，
menu `when` 從 `viewItem == ...entry` 放寬到 entry 或 folder：

| 來源 | 行為 |
| --- | --- |
| 釘選列 | 從 `superset.cliLauncher.entries` 移除（原本的 Unpin） |
| 掃描列 | 加進 `superset.cliLauncher.hidden` |

`hidden` 是新的 `application` scope 字串陣列，與 `roots` 同樣寫入 Global。
`isHiddenPath` 以`路徑或其祖先`比對：移掉一個第一層資料夾等於連同其下第二層一起
移除，且 `/opt/website` 不會被 `/opt/web` 命中（比對 `<hidden>/` 前綴，不是字串
前綴）。過濾在 `scanRoots` 內完成 —— 命中的第一層直接跳過，連它的 `readdir` 都省下。

移除只寫 settings，不碰磁碟上的資料夾。回頭路是新命令
`superset.cliLauncherRestoreHidden`（`Restore Hidden Paths`，view title 選單，可多選）；
沒有這個出口，移除就等於只能手動編輯 settings 才救得回來。

### 面板可見時每 30 秒自動重刷

git 分支與行數增減沒有可訂閱的事件來源（外部 terminal 的 commit / checkout /
stash 不會通知 extension host），只能定期重讀。`CLILauncherTreeProvider` 因此持有
一個 `AUTO_REFRESH_INTERVAL_MS = 30_000` 的 `setInterval`，每次 tick 呼叫既有的
`refresh()`。

timer 由 `registerViewVisibility` → `setVisible(visible)` 啟停，與 `Terminals`
面板的作法一致：掃描沒有快取，隱藏的面板每 30 秒打一輪 `readdir` + `git` 是純浪費。
timer 一律 `unref()`，且 `dispose()` 先停 timer 再放其他資源 —— 週期 timer 不得
成為讓孤兒 extension host 活著的那個 handle。

## 涵蓋範圍 (Scope)

- 改動：`src/cliLauncher/{gitStatus,tree,entries,config,scan,index}.ts`、
  `package.json` 的設定／命令／menu 宣告。
- 未改動：git 讀取策略（`.git` gate、批次併發、第二層延後讀取）、terminal 追蹤、
  過濾規則。

## 驗證 (Verification)

`npm test`：

- `cliLauncherGitStatus`：`formatGitFolderDescription` 的四種情境。
- `cliLauncherTree`：靜止列 description 為空但 tooltip 仍有值、tooltip 只有兩行、
  hidden 設定確實傳進掃描、自動重刷只在 visible 時排程且 `dispose()` 後停止。
- `cliLauncherScan`：隱藏第一層連帶子層、隱藏第二層保留父層、名稱前綴不誤判。
- `cliLauncherEntries`：`normalizeHiddenPaths` / `isHiddenPath` /
  `appendHiddenPath` / `removeHiddenPath`。
- `packageManifest`、`extensionActivate`：命令標題、menu `when`、四個
  `application` scope 設定與新命令的註冊。
