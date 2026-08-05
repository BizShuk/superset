# CLI Launcher:`Remove from Panel` 套用整份選取

2026-08-05 實作。把 `Remove from Panel` 從「只作用在游標下那一列」改成「作用在
tree view 目前的整份選取」。

## 問題

CLI Launcher 掃描深度固定兩層,而且`不`按內容篩選 —— 這是刻意的:要挑的 cwd 不限
於 git repository,若改成只列有 `.git` 的資料夾,「東西不見了」就變成一個沒有出口
的狀態。代價是清單一定會混進不想看到的資料夾,所以 `superset.cliLauncher.hidden`
是清理面板的唯一機制。

但 `Remove from Panel` 原本只認命令參數的`第一個` argument:面板明明是
`canSelectMany: true`,多選十列右鍵移除卻只會移掉一列,而且每移一列就跳一次 modal
確認。要清掉幾十個雜訊資料夾等於按幾十輪對話 —— 唯一的清理機制本身變成了瓶頸。

同一份選取在`啟動`類命令(`Open with Claude` / `Codex` / `Grok`、
`Open Terminal at Path`)早就是多列語意,兩者行為不一致本身也是驚訝來源。

## 決策

啟動類命令原本就以 `resolveEntries` 把命令參數解析成`一組` entries,優先序為
`targets` → `target` → `view.selection` → quick pick。`Remove from Panel` 改成走
同一條路徑,差別只有第 4 步 quick pick 的候選清單不同(以 `fallback` 參數注入
`pickRemovableEntry`)。

- 確認對話只跳`一次`。單選沿用原本點名的句子(`取消釘選「superset」?`),多選只
  報數量 —— 列出十幾個 label 反而看不完。
- 釘選列與掃描列可以混在同一份選取:逐項判斷來源,各自走 `entries` / `hidden`。
  只有`全部`都是釘選列時,動作字樣才是「取消釘選」,否則一律是「從面板移除」。
- 已經不在清單裡的路徑不算失敗,結束後合併回報一次數量。
- inline 按鈕維持單列語意:VS Code 對 inline group 不帶 `targets`,而 hover 到哪一
  列就跑哪一列本來就是使用者的預期。

移除的語意本身不變:只改 settings,不動磁碟上的資料夾,`Restore Hidden Paths`
仍是還原出口。

## 影響範圍

- `src/cliLauncher/index.ts` —— `resolveEntries` 可注入 fallback picker;
  `removePathInteractively` 改吃 `CommandContext`,確認與寫入都改成批次。

## 相關規格

- [CLI Launcher 本體](2026-08-04-cli-launcher.md)
- [移除路徑與靜止 git 狀態](2026-08-04-cli-launcher-remove-path.md)
