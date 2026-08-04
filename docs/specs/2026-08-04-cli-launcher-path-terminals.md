# CLI Launcher Path Terminal 清單

- 日期：2026-08-04
- 狀態：已實作 (`0.28.0`)
- 相關規格：[`2026-08-04-cli-launcher.md`](2026-08-04-cli-launcher.md)

## 問題 (Problem)

CLI Launcher 能在同一 path 啟動多個 agent terminals，但 path row 只顯示 Git 資訊。
使用者無法從 CLI View 看出目前開了幾個 terminals，也不能像 Superset `Terminals`
View 一樣展開清單並點擊切回某個 terminal。舊 tracking map 對每個 `(path, agent)`
只保留一筆；busy 時建立新 terminal 會 overwrite 舊 record，因此不能作為準確 count。

## 決策 (Decision)

新增 runtime-only `CLITerminalTracker`，以 terminal instance 保存
`{id, path, agent, phase, terminal}`。一個 `(path, agent)` 可以同時有多筆 live
records；只有 idle terminal 可以 reuse，busy launch 會新增 record 而不覆蓋舊 terminal。

Tracker 只收 CLI Launcher 在目前 Extension Host runtime 建立的 terminals，不掃描
既有 terminals，也不靠 cwd 猜測 ownership。`onDidCloseTerminal` 移除精確 record；
Shell Integration events 維持 `pending → running → idle` 的配對 transition。

## Tree View 契約

- Path 有 terminal 時，description 格式為 `🟡 <count> · <git summary>`；沒有 Git
  時只顯示 `🟡 <count>`，count 為零時保留原 Git description 且不顯示 indicator。
- 展開 path 後，terminal rows 固定排在 Layer 2 folders 前面；原本的 leaf path 有
  terminal 時變為 collapsible。
- Terminal row label 使用 terminal name；內部 `pending` / `running` 顯示
  `running`，`idle` 顯示 `idle`。
- 點擊 terminal row 呼叫既有 `superset.focus`，argument 是同一個 terminal instance。
- Tracker event 只更新已 materialized 的同 path row；Layer 2 Git 結果在該 path item
  存活期間重用，terminal lifecycle 不重新掃 roots 或執行 Git commands。

## 限制 (Limitations)

- Extension Host reload 會清空 CLI tracker；舊 terminal 分頁保留，但不會重新列入。
- `Open Terminal at Path` 建立的 plain terminal 計入 count；使用者之後手動輸入的命令
  不屬於 CLI Launcher 派送流程，因此狀態維持 `idle`。
- 本功能不增加 terminal limit、rename/close action、unseen-output tracking 或持久化。

## 驗證 (Verification)

- `test/cliLauncherTerminal.test.ts`：multi-record retention、phase transition、idle reuse
  與 close cleanup。
- `test/cliLauncherTree.test.ts`：indicator/Git composition、terminal-first children、
  `running` / `idle` description、`superset.focus` command 與 path-only refresh。
- 完整驗證使用 `npm test` 與 `npm run build`。
