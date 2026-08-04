# CLI Launcher

## Scope

`cliLauncherPlugin` 擁有 Activity Bar 上獨立的「CLI」view container 與其中唯一的
`superset.cliLauncher.paths` view。面板以兩層樹狀列出系統資料夾;每一列有三顆
inline 按鈕,各自開一個 terminal 並在該路徑執行 `claude`、`codex`、`grok`。

本 feature 由 `vscode-plugin-experiment` 的 `cli_launcher/` folder-as-feature 模組
移入 Superset,行為維持不變,只有下列移植差異(見 §移植差異)。

## 樹的形狀

預設掃描 `~/projects`(`superset.cliLauncher.roots`)。**root 本身不是節點**:

```text
CLI
├── ai              ← <root>/<layer1>,top level
├── tools           ← 可展開
│   ├── autop       ← <root>/<layer1>/<layer2>,leaf
│   └── pm2
└── web
```

深度固定兩層(`SCAN_DEPTH`),第二層不再往下展開 —— 更深的層級對「挑一個 cwd
啟動 CLI」沒有幫助。這個形狀刻意對齊 `~/projects` 的兩層佈局慣例
(`<category>/<project>` 或根層 `<project>`),但實作不做「這是不是專案」的判斷,
任何資料夾都是合法的 cwd。

## 資料流

```text
`superset.cliLauncher.roots`     → normalizeRootPaths() → scanRoots()  # 掃兩層資料夾
`superset.cliLauncher.entries`   → normalizeEntries()                  # 手動釘選
  → CLILauncherTreeProvider.getChildren()   # 釘選在前,掃描結果在後
  → CLIEntryTreeItem              # contextValue = superset.cliLauncher.entry / .folder
  → inline button / ctrl+1,2,3 / 右鍵
  → resolveEntries()              # targets[] → target → view.selection → quick pick
  → launchAll(entries, agentCommand, agent)
  → buildShellCommand()           # cd '<path>' && <agent 命令>
  → createNativeTerminal()        # terminals/nativeTerminal.ts,唯一 createTerminal call site
  → waitForTerminalReady()        # 新 terminal 等 shell ready,最多 3 秒
  → Terminal.sendText(line, true) # 可見地輸入並送出 command

workspace.onDidChangeConfiguration → provider.refresh() → 重新掃描
```

## 模組對應

| 模組 | 職責 | 主要介面 |
| ---- | ---- | -------- |
| `src/cliLauncher/entries.ts` | settings 陣列的正規化與增刪(純函式,不依賴 `vscode`) | `normalizeEntries()`、`normalizeRootPaths()`、`appendEntryPath()`、`removeEntryPath()`、`expandHome()`、`collapseHome()`、`formatPathList()`、`toCLIEntry()` |
| `src/cliLauncher/scan.ts` | 掃描 root 底下兩層資料夾(只依賴 `node:fs`) | `scanRoots()`、`listSubdirectories()`、`isListableDirectory()`、`SCAN_DEPTH` |
| `src/cliLauncher/command.ts` | agent 命令解析與 shell 字串組裝(純函式) | `AGENT_IDS`、`resolveAgentCommands()`、`quoteShellPath()`、`buildShellCommand()`、`terminalNameFor()` |
| `src/cliLauncher/config.ts` | settings 讀寫的唯一入口(VS Code adapter) | `loadEntries()`、`loadRoots()`、`loadAgentCommands()`、`addEntry()`、`removeEntry()` |
| `src/cliLauncher/tree.ts` | 「CLI」view 的兩層 TreeDataProvider | `CLILauncherTreeProvider`、`CLIEntryTreeItem` |
| `src/cliLauncher/log.ts` | 綁定共用診斷 log sink 的 module-level shim | `setCLILauncherLog()`、`log()` |
| `src/cliLauncher/terminal.ts` | terminal 的建立／重用、shell readiness 與命令執行 | `initTerminalTracking()`、`launch()`、`launchAll()` |
| `src/cliLauncher/index.ts` | 註冊 view、命令與設定變更監聽 | `register()` |
| `src/cliLauncher/plugin.ts` | `legacyPlugin` shim | `cliLauncherPlugin` |

## 設計決策

- 用 native **TreeView** 而非 webview:`contributes.menus` 的 `view/item/context`
  `inline` group 原生支援每列多顆按鈕,不需要自行維護 HTML、CSP 與訊息協定。
- **樹以掃描為主、釘選為輔**。預設不需要任何設定就能用;
  `superset.cliLauncher.entries` 只是把 root 之外的路徑釘到最上面,並提供
  `Unpin Path`。掃描出的資料夾沒有「移除」語意 —— 要調整清單就改
  `superset.cliLauncher.roots`。
- **settings 是唯一資料來源**,沒有額外的 `globalState`。使用者手改 JSON、或
  Settings UI 修改,都會經由 `onDidChangeConfiguration` 立即反映到面板。
- 掃描是 **eager 兩層**:建立 top level 時就一併讀取第二層,因為
  `TreeItem.collapsibleState` 必須在建立當下就決定有沒有子節點,否則會出現展開後
  空無一物的箭頭。`~/projects` 規模下是 1 + N 次 `readdir`,成本可忽略。
- `readdir` 失敗(root 不存在、無權限)一律回傳空陣列。設定裡有個打錯的 root
  不該讓整個面板變成錯誤畫面。
- `Dirent.isDirectory()` 對 symlink 一律回傳 false,因此 symlink 另外 `stat`
  確認指向目錄 —— `~/projects` 底下用 symlink 掛載其他磁碟的情況很常見。
- 路徑寫入 **Global (User settings)** 且 `scope: application`:「系統層路徑」不應
  隨 workspace 切換而消失。
- **點擊不啟動任何東西**。tree item 刻意不設 `command`,點擊只做選取／展開;
  啟動一律經由 inline 按鈕、`ctrl+1/2/3` 或右鍵選單,避免瀏覽時誤開一堆 terminal。
- **項目本身沒有預設命令**。要跑什麼由三顆 agent 按鈕決定。
- **terminal 開在 editor area**。`createNativeTerminal(..., {location: {viewColumn:
  Active}})` 讓它成為編輯區的一個分頁而不是底部 panel —— claude／codex／grok 都是
  全螢幕 TUI,吃得下編輯區的高度;多選啟動時每個項目也各自是一個分頁。
- **多選一次啟動**。`canSelectMany: true`;`resolveEntries()` 的優先序是
  `targets[]`(右鍵一份選取)→ `target`(inline 按鈕只作用在被點的那列)→
  `view.selection`(keybinding 沒有命令參數,只能回頭問 tree view)→ quick pick。
  每個項目各自一個 terminal,只有最後一個 `reveal`,否則逐個搶焦點。
- **命令參數用 duck typing 解析,不用 `instanceof`**。命令參數會跨過 VS Code 的
  menu 層,module 實體不同或型別改變時 `instanceof` 會靜默失敗成「按了沒反應」。
  `toCLIEntry()` 只要求形狀對(`.entry` / `.path` / `.fsPath` / `.resourceUri`)。
- **每一步都寫診斷日誌**。面板按鈕的失敗發生在使用者的 IDE 裡,沒有 stack trace
  可看;`Superset: Show Diagnostic Logs` 會列出命令、解析到的項目數與實際送進
  terminal 的字串。
- 每次送出的命令都自帶 `cd '<path>'`。terminal 會被重用,其 cwd 可能已被使用者
  改掉;倚賴建立當下的 cwd 並不安全。
- 新 terminal 不會立刻送出 command:先等待
  `onDidChangeTerminalShellIntegration` 作為 shell readiness signal,最多 3 秒後
  繼續。實際 delivery 統一用 `Terminal.sendText(line, true)`,讓 command 文字在
  terminal 可見並送出 Enter。`TerminalShellIntegration.executeCommand()` 成功回傳
  execution object 不代表 command 已交給 shell,因此不用它作 delivery path。等待
  期間 terminal 被關閉則立即 abort,不對已結束 terminal 送文字。
- 路徑一律以 POSIX single quote 包裝(`'` 內部只需把 `'` 換成 `'\''`),含空白、
  `$`、`&` 的路徑都不會被 shell 展開或截斷。
- terminal 名稱為 `<label> · <agent>`(預設開啟則是 `<label>`),但**重用以
  (path, agent) 為 key**,不比對名稱 —— label 取 basename,不同路徑(`tools/foo`
  與 `web/foo`)會撞名,以名稱比對會互搶對方的 terminal。
- **只重用閒置的 terminal**。agent 還在跑 TUI 時把命令送進去只會打進 TUI 的
  stdin,看起來就是「按了沒反應」。因此非空命令在 delivery 前進入 `pending`,
  `onDidStartTerminalShellExecution` 收到後轉為 `running`,只有對應的
  `onDidEndTerminalShellExecution` 才轉回 `idle`。沒有 start 的 stale end event
  不會錯誤解除 busy;busy 期間再點按鈕會開新 terminal。`onDidCloseTerminal` 負責
  清掉追蹤,terminal 已結束(`exitStatus !== undefined`)時也重新建立。

## 設定契約

| 設定 | 型別 | 說明 |
| ---- | ---- | ---- |
| `superset.cliLauncher.roots` | `string[]` | 要掃描的根目錄,預設 `["~/projects"]`。面板列出其下兩層資料夾,root 本身不出現。以 `.` 開頭的目錄與 `node_modules` 略過。設成 `[]` 即關閉掃描 |
| `superset.cliLauncher.entries` | `(string \| {path, label?})[]` | 手動釘選的路徑,排在掃描結果之前。字串簡寫等同 `{path}`;`~` 展開為 home directory;label 預設取 basename;重複路徑只保留第一筆;格式錯誤的項目直接忽略而不是讓整個面板失效 |
| `superset.cliLauncher.agentCommands` | `{claude, codex, grok}` | 三顆按鈕送進 terminal 的命令,可含旗標。非字串或空白值 fallback 回同名 CLI |

| 命令 | 標題 | 快捷鍵 |
| ---- | ---- | ------ |
| `superset.cliLauncherRunClaude` | Open with Claude | `ctrl+1` |
| `superset.cliLauncherRunCodex` | Open with Codex | `ctrl+2` |
| `superset.cliLauncherRunGrok` | Open with Grok | `ctrl+3` |
| `superset.cliLauncherOpen` | Open Terminal at Path | — |
| `superset.cliLauncherAddPath` / `superset.cliLauncherRemovePath` | Pin / Unpin Path | — |
| `superset.cliLauncherCopyAllPaths` | Copy All Paths | — |
| `superset.cliLauncherRefresh` | Refresh | — |

`Copy All Paths` 是面板標題列(`view/title`)的按鈕,不看目前選取狀態 —— 把
`listAllEntries()`(釘選 + 掃描兩層,與面板渲染順序一致)的絕對路徑各佔一行寫進
剪貼簿,並跳出「已複製 N 個路徑」的提示。

快捷鍵的 `when` 是 `focusedView == superset.cliLauncher.paths`,只在面板取得焦點時
覆蓋 VS Code 內建的 `ctrl+1/2/3`(切換 editor group)。從 Command Palette 呼叫且
面板沒有選取時,會改以 quick pick 選擇單一項目。

## 移植差異 (Port Deltas)

從 `vscode-plugin-experiment/cli_launcher/` 移入時,只有下列四項與原實作不同:

1. **Namespace**:view container `cliLauncher` → `cli`;view `cliLauncher.paths` →
   `superset.cliLauncher.paths`;命令 `cliLauncher.run.claude` →
   `superset.cliLauncherRunClaude`(其餘同此規則);設定 `cliLauncher.*` →
   `superset.cliLauncher.*`;contextValue 同樣加上 `superset.` 前綴。舊命名的
   User settings 不會自動搬移,需重新釘選。
2. **Terminal 建立**:不再直接呼叫 `vscode.window.createTerminal`,改走
   `src/terminals/nativeTerminal.ts#createNativeTerminal`。該函式新增選用的
   `options.location`,只有 CLI Launcher 會傳入;其餘 call site 產生的
   creation options 一字未改。
3. **診斷輸出**:移除 feature 專屬的 `CLI Launcher` Output Channel 與
   `cliLauncher.showOutput` 命令,改寫進共用的 `Superset` channel
   (`Superset: Show Diagnostic Logs`),每行以 `[cliLauncher]` 前綴。
4. **生命週期**:`register()` 回傳 `FeatureHandle`,由 `PluginManager` 負責錯誤
   隔離與 teardown;原本的 try/catch 包裹與 `context.subscriptions` 直接寫入都改成
   `ctx.subscriptions` + `ctx.resetHandlers`(`Reset Caches` 等同重新掃描),
   module-level 的 terminal 追蹤表與 log sink 在 dispose 時一併清空。

## 已知限制

- `buildShellCommand()` 假設 POSIX shell(`bash` / `zsh` / `fish`)。Windows 的
  `cmd.exe` 與 PowerShell 不接受 single-quote 語法。
- 按鈕固定三顆(`claude` / `codex` / `grok`);命令內容可設定,但數量與順序由
  `package.json` 的 `view/item/context` inline group 決定,不是動態的。
- 釘選路徑不做存在性檢查。指向已刪除的目錄時,terminal 會由 shell 自行報 `cd`
  失敗(掃描出來的資料夾在掃描當下必然存在)。
- 沒有 filesystem watcher:外部新增／刪除資料夾後,需按面板標題列的 `Refresh`
  (或改動任何 `superset.cliLauncher.*` 設定)才會重新掃描。
- 沒有 shell integration 的 terminal 不會發出 `onDidEndTerminalShellExecution`,
  busy 永遠不解除 —— 該項目之後每按一次都開新 terminal。寧可多一個分頁,也不把
  命令打進看不見的 TUI stdin。
- Extension Host reload 後追蹤表清空,既有 terminal 分頁不再被重用,第一次點擊會
  另開新 terminal(舊分頁保留給使用者自行處理)。
- 掃描不判斷「這是不是一個專案」,任何資料夾都會列出。因此展開一個專案會看到
  它的 `src/`、`docs/` 等子目錄。要縮小清單就調整 `superset.cliLauncher.roots`。

## Ownership and verification

- 純資料層:`test/cliLauncherEntries.test.ts`、`test/cliLauncherCommand.test.ts`。
- 檔案系統掃描(在 `os.tmpdir()` 建真實目錄樹):`test/cliLauncherScan.test.ts`。
- terminal 重用／busy／readiness／editor-area location:
  `test/cliLauncherTerminal.test.ts`。
- Manifest 契約(container、view、命令、keybinding scope、設定 scope):
  `test/packageManifest.test.ts`。
- Activation(view 與命令真的註冊):`test/extensionActivate.test.ts`。
