# Superset 專案說明 (Project Notes)

Superset 是 VS Code 擴充功能，提供終端機活動偵測與高亮、TODO / 專案 / 網路面板，以及 Markdown `tree` 與 `README.todo` 預覽。對外功能、安裝與使用方式見 [`README.md`](README.md)；本檔只保留維護所需的技術脈絡與入口。

- 進行中、尚未實作的設計放在 [`plans/`](plans/)。
- 已實作的現行設計與仍需維持的問題解法放在 [`docs/specs/`](docs/specs/)。
- Superset 全專案術語、VS Code UI 名稱與各 feature domain 用語以 [`docs/terminology.md`](docs/terminology.md) 為準。
- 每次變更都依 semantic versioning (`major` / `minor` / `patch`) 更新 `package.json` 與 `package-lock.json` 的 package version。

## 與根 `CLAUDE.md` 的關係

本專案是 `vscode-plugin-experiment` 的 git submodule，位於其 `superset/` 目錄。

- 根 `../CLAUDE.md`：跨專案方向與聚合層指令。
- 本檔：Superset 專屬建置指令、目前架構與不可破壞的契約。

兩者不重複記錄建置細節；業務範圍變更時同步更新 [`README.md`](README.md)，結構或關鍵決策變更時同步更新本檔。

## 常用指令 (Commands)

從 `superset/` 根目錄執行：

| 動作 | 指令 |
| --- | --- |
| 依 lockfile 安裝相依套件 | `npm ci` |
| 清理、編譯、打包並驗證 VSIX | `npm run build` |
| 邊改邊編譯 | `npm run dev` |
| 跑單元測試 | `npm test` |
| 持續跑測試 | `npm run test:watch` |
| 單獨打包 `.vsix` | `npm run build:vsix` |
| 產生 Sessions 面板假資料 | `./scripts/seed-sessions.sh`（`-l` 只列出、`-c` 清除、`-h` 說明） |

執行環境以 `package.json#engines` 為準：VS Code `^1.93.0`、Node.js `>=20.0.0`。現行設計與相容性問題集中於 [`docs/specs/2026-08-06-Summary.md`](docs/specs/2026-08-06-Summary.md)。

## 架構速覽 (Architecture)

`src/extension.ts` 是 declarative composition root。它建立 active `PluginManager`、Tree View registry、diagnostic channel 與 native terminal capability，透過單一 `PluginContext` 注入所有 plugin；root `deactivate()` 反向停用 plugin 並釋放 root-owned resource。`PluginManager` 負責生命週期、錯誤隔離、disposable、reset handler、runtime diagnostics 與 Markdown extension 組合。`panelLayoutPlugin` 必須最後啟用，確保恢復 view focus 時其他 TreeView 已完成註冊。

| 模組 | 職責 | 主要入口 |
| --- | --- | --- |
| `src/plugin/` | Plugin lifecycle、context、TreeView registry、visibility boundary | `PluginManager` |
| `src/diagnostics/` | Runtime metric keys 與 diagnostics Markdown renderer | `renderDiagnosticsMarkdown` |
| `src/terminals/` | 終端機面板、高亮、群組、activity 偵測、原生 terminal 開啟 | `terminalsPlugin` |
| `src/mermaid/` | Mermaid preview command（detection 已移除） | `registerMermaidPreviewCommand` |
| `src/mdns/` | mDNS 服務發現與細節 | `mdnsPlugin` |
| `src/topology/` | 網路拓撲掃描與 tree 轉換 | `topologyPlugin` |
| `src/sessions/` | Agent session 清單與 summary markdown(讀 `sessiond` JSONL) | `sessionsPlugin` |
| `src/todo/` | 當前 workspace 遞迴掃描的 `README.todo` 與 plans（含 workspace store / tree provider） | `todoPlugin` |
| `src/git/` | Explorer GitHub URL、Git hooks Install/Link 與 Status Bar | `gitPlugin` |
| `src/editorLayout/` | Editor group 固定佈局規則（左右均分 × 作用中列放大）與網格形狀 | `editorLayoutPlugin` |
| `src/diskUsage/` | 第一個 workspace volume 的 disk capacity Status Bar 顯示與週期刷新 | `diskUsagePlugin` |
| `src/cliLauncher/` | 獨立「CLI」container：`Repo Path` 掃描與 agent terminals；`Change` 提供 grouped status、staging actions 與 Diff Editor | `cliLauncherPlugin` |
| `src/installCommands.ts` | Default Project、Default Tools、Skill Install 與 Projects Setup commands | `registerInstallCommands` |
| `src/treePreview/` | Markdown `tree` fence 渲染 | `treePreviewPlugin` |
| `src/todoPreview/` | `README.todo` 預覽重組與 CSS 互動 | `todoPreviewPlugin` |
| `src/panelLayout/` | TreeView layout persistence | `panelLayoutPlugin` |

目前 module 行為、資料流與已遇到的問題集中於 [`docs/specs/2026-08-06-Summary.md`](docs/specs/2026-08-06-Summary.md)。

## 維護契約 (Invariants)

- Feature 直接放在 `src/<feature>/`；domain types 留在 feature 內，共用 framework contracts 放在 `src/plugin/`。
- `treePreview`、`todoPreview` 是 Markdown contributor，不是 TreeView `register()` feature；hook 順序由 `src/extension.ts` 決定。
- 所有 feature 一律直接接受 `PluginContext`；不得重建 `FeatureContext`、legacy adapter 或 module-level cross-feature getter/setter。Disposable、reset handler、Tree View registration 與 diagnostics provider 都由 `PluginManager` 依 plugin owner 管理。
- 根 `deactivate()` 必須 await `PluginManager.deactivateAll()`，再 dispose diagnostic channel。`PluginContext.registerDisposable()` 寫入的是 manager-owned pool，不是 VS Code 的 `ExtensionContext.subscriptions`，不得假設 host 會自動釋放；啟用失敗也必須立即清掉該 plugin 已註冊的部分資源與 diagnostics provider。長週期 maintenance timer 仍須 `unref()`，但 `unref()` 只是防線，不能取代 teardown。
- `Superset: Reset Caches` 清除 workspace cache 後必須 await `PluginContext.resetAll()`；feature reset 只能透過 `registerResetHandler()` 註冊。`Superset: Show Diagnostics` 只讀 live provider，不得使用 placeholder count；單一 provider 失敗必須 fail-soft 並保留其他 plugin snapshot。
- TODO link parsing 與 copy formatting 的唯一 source of truth 是 `src/todoEngine/linkUtils.ts`，TODO 面板與 Markdown 預覽不另建副本。
- Terminal 一律由 VS Code 擁有。Superset 不持有 pseudoterminal、不 wrap、不替換、不重建既有 terminal；唯一開 terminal 的地方是 `src/terminals/nativeTerminal.ts#createNativeTerminal`（`vscode.window.createTerminal`），composition root 將它注入 `PluginContext.createTerminal`，面板命令、install/Git/mDNS actions 與 CLI Launcher 都走此 capability，不得在其他 call site 直接呼叫 `vscode.window.createTerminal`。`createNativeTerminal` 的選用 `options.location` 只服務 CLI Launcher 的 editor-area 分頁需求；不傳時產生的 creation options 必須與原本的 panel 預設完全一致。
- `TerminalRegistry` 是終端機狀態來源；`markUnseen` 必須保持 idempotent。`onDidOpenTerminal` 只做 `registry.add`，唯一排除條件是 `terminalFilter.ts#shouldTrackTerminal`（agent-owned 名稱），不得再依 creation options 分流。
- Tree View visibility 一律由 `src/plugin/viewVisibility.ts#registerViewVisibility` 接線並解構 event 的 `visible` boolean。UI-only polling / watcher 必須隨 View visibility 啟停；terminal activity source `A` / `B` 與 registry subscriptions 不屬於 UI-only work，不得因面板隱藏而停止。
- Activity 偵測的預設路徑是`零位元組`的來源 `A`（`processActivitySource`，進程樹輪詢）與 `B`（`shellIntegrationActivitySource`，execution start/end edge）。來源 `B` 不得呼叫 `execution.read()`；讀取位元組的 `OutputWatcher` 只在 `superset.terminals.legacyOutputWatcher` 開啟時建立。抑制政策（不在 registry / 正在 focus / 最近 focus / 已是 unseen）只能存在於 `ActivityCoordinator` 一處，不得再複製回各來源。
- 診斷日誌只在 `seen → unseen` 真的翻轉時輸出。被抑制的路徑是熱路徑，逐事件記錄會讓 OutputChannel 自己變成 EH 主執行緒的效能問題；Shell Integration reason 與 legacy `OutputWatcher` 日誌不得包含 command text 或 output payload，只能保留 lifecycle edge、exit code 與 byte count。
- 來源 `A` 每個 poll 只跑`一次` `ps`（供所有 terminal 共用），下一 tick 只在當前 tick settle 後排程，且 timer 必須 `unref()`。判定用累積 CPU 時間（`ps -o time=`）的 delta 而非 `%cpu`，並排除 shell 自身的 CPU —— 互動式 shell 光是重繪 prompt 就會累積，計入會讓每個閒置 terminal 看起來都在忙。
- Extension 不得引入 native pseudoterminal binding（`node-pty`、`@homebridge/node-pty-prebuilt-multiarch` 或任何 fork）。`scripts/verify-vsix.sh` 必須拒絕含有這些套件的 VSIX —— 它們會把 per-platform prebuild、executable bit 與 rebuild 失敗模式帶回打包流程。不可在 `.vscodeignore` 排除 production `node_modules`。
- `npm run clean` 必須先移除 generated `out/`，避免已刪 source 的 stale JavaScript 進入 VSIX。`npm run build` 必須以 `npm ci` 依 lockfile 重建 dependency tree，並使用 manifest 中 exact-pinned 的 `@vscode/vsce`，不得以未固定版本的 `npx` 下載打包器。`.vscodeignore` 排除 workspace metadata、native `.pdb` 與 dependency source/test payload，但必須保留 `pkg/resources/`；`scripts/verify-vsix.sh` 必須拒絕沒有對應 `src/*.ts` 的 packaged `out/*.js`。
- `spawnRunTerminal` 送出的是 `sendText(cmdline)`，不得補 `\r`：那是舊 PTY `handleInput` 的原始按鍵位元組語意，原生 terminal 會讀成第二次 Enter。
- CLI Launcher 的唯一資料來源是 `superset.cliLauncher.*` settings（`scope: application`、寫入 Global），不得引入 `globalState` 副本；掃描深度固定兩層且 root 本身不是節點。掃描讀取失敗一律回空陣列，一個打錯的 root 不得讓面板變成錯誤畫面。`entries` 與 `hidden` 的 Regex 一律使用 `{regex, flags?}`，同時比對 normalized absolute 與 `~/...` path；invalid pattern fail-soft 忽略。`entries` Regex 只展開兩層 scan candidates，不得引入無界 traversal；explicit literal entry 優先，`hidden` 則優先於 scan-derived Dynamic Entry。預設 repository 與 explicit entry 都必須能移除：literal 釘選列走 `entries`，掃描列與 Dynamic Entry 寫進 `superset.cliLauncher.hidden`（命中自己或任一祖先都不列出，且 `Restore Hidden Paths` 必須同時能還原 literal 與 Regex rule）。移除只改 settings，不得碰磁碟上的資料夾。
- CLI Launcher 送進 terminal 的每一行都自帶 `cd '<path>'`，路徑一律以 POSIX single quote 包裝；terminal 重用以 `(path, agent)` 為 key，不比對顯示名稱（label 取 basename 會撞名）。一個 key 可以同時擁有多個 live terminal：非空命令在 delivery 前標記 `pending`，只有配對的 `onDidStartTerminalShellExecution` → `onDidEndTerminalShellExecution` 才解除 busy；busy 期間一律開新 terminal，且不得 overwrite 舊 tracking record 或把命令送進正在跑的 agent TUI stdin。
- CLI Launcher 的 `Filter Paths` 必須先 focus `superset.cliLauncher.paths`，再開啟 VS Code native Tree/List Find Control；不得恢復 extension-owned input box、query state、`Clear Filter` command 或 provider-side path filtering。每個 Extension Host runtime 第一次開啟時預設為 `Filter` + `Fuzzy Match`，之後保留使用者在 native control 內的 toggles；不得為此修改全域 `workbench.list.*` settings。`Cmd+F` 仍只在 CLI View focused 且沒有 input focus 時啟動。Native query 由 VS Code 擁有，因此 `Copy All Paths` 一律複製完整 catalog。
- CLI Launcher 每一列的 description 是該路徑的 git 摘要 `<branch><↑ahead><↓behind>(+<新增行>,-<刪除行>)`，不是路徑。tooltip 只承載兩件事：完整 git 摘要與 `CLI terminals: <count>`，不再重複 label、路徑或操作提示。行數取 `git diff HEAD --numstat --ignore-submodules=all` 的加總（staged + unstaged，未追蹤不計，二進位略過，submodule gitlink 指標更新不計 —— parent repo 沒有任何檔案內容改變，計入會讓只是 pin 前進的 workspace 看起來有一堆待處理編輯，submodule 自己的改動由它自己那一列顯示）；分支取 `git branch --show-current`，detached 時退回短 hash。領先／落後取 `git rev-list --count --left-right @{upstream}...HEAD`（左是 upstream 獨有＝behind，右是 HEAD 獨有＝ahead），沒有 upstream 或解析失敗一律當 0/0；為 0 的那一邊不顯示符號。這個查詢讀的是`本地既有的` remote-tracking refs，必須保持純本地、每次刷新都能算，不得為了取得數字而在讀 status 的路徑上連網。執行 git 前必須先確認`資料夾自己`有 `.git`（目錄或 submodule 的檔案）—— git 預設會沿父層往上找 repository，少了這個 gate，`~/projects/platform` 會顯示 `~/projects` 的狀態。description 只隱藏「預設分支（`master` / `main`）、零改動且與 upstream 同步」這一種靜止狀態，其餘一律顯示（乾淨的 `w-*` 分支也要顯示 —— 站在哪個分支本身就是資訊）；被隱藏的完整值仍由 tooltip 提供，判斷集中在 `gitStatus.ts#formatGitFolderDescription`。非 repo 與讀取失敗兩者 description 與 tooltip 的 git 段落都空白；任何失敗（沒有 git、逾時、輸出過大）都當成沒有資訊，不得變成錯誤畫面。同一層的路徑要一次批次查詢（併發上限 8，分支、diff 與 ahead/behind 併發發出），第二層只在展開時才讀，不得逐列 await 或開面板就掃完兩層。
- CLI Launcher 只追蹤目前 Extension Host runtime 由自己建立的 terminals，不掃 `vscode.window.terminals` 或猜測其他 terminal 的 cwd。path 有 live terminal 時，description 在 git 摘要前顯示 `<mark> <count> ·`，且這個 count `含子孫路徑`（以路徑字首彙總，不是加總已建立的子列 —— 尚未展開的第二層一樣要算）。description 只放`一個`數字，來源改用顏色表示：自己有 terminal 是 `🟡`，自己沒開、數字全來自子資料夾是 `🔵`；不得改回 `(here: N)` 之類的文字補述 —— 同一列還要塞 git 分支與行數增減，橫向空間有限，tooltip 維持只有完整 git 摘要與 `CLI terminals: <total>`；`collapsibleState` 與展開後列出的 terminal rows 仍只看 path `自己`的 terminals，排在 folder rows 前，`pending` / `running` 顯示 `running`、`idle` 顯示 `idle`，點擊走既有 `superset.focus`。terminal lifecycle event 只能刷新受影響的 path row `與其祖先列`（祖先的 count 含子孫，不跟著更新就會停在舊數字），不得重掃 roots 或重跑 git；Extension Host reload 後不接管舊 terminal。
- CLI Launcher 的面板可見時每 `5` 分鐘（`tree.ts#AUTO_REFRESH_INTERVAL_MS`）自動全樹重刷一次：git 分支與行數增減沒有可訂閱的事件來源，只能定期重讀。timer 由 `registerViewVisibility` → `setVisible` 啟停（隱藏即 `clearInterval`），必須 `unref()`，且 `dispose()` 要先停 timer 再放其他資源。不得改成不看 visibility 的常駐 timer —— 掃描沒有快取，隱藏的面板每輪都是白費的 `readdir` + `git`。
- `git fetch` 只由使用者按下 `Refresh`（`superset.cliLauncherRefresh` → `tree.ts#refreshWithFetch`）觸發，不得掛在自動刷新的 timer 上 —— 那等於替每個開著面板的人固定對所有遠端發流量與認證。`refreshWithFetch` 先立刻重畫一次（路徑清單與本地 git 狀態不等網路），只 fetch `已材料化`的列（top level 加上展開過的第二層），抓完再重畫一次；fetch 併發上限 4（低於本地查詢的 8）、逾時 20 秒，且同一時間只允許一輪。任何 fetch 失敗（沒有 remote、離線、認證、逾時）一律安靜略過並保留上一次已知的數字，不得變成錯誤畫面或阻擋面板更新。
- CLI Launcher 的 raw scan candidates 仍只看「是不是可列出的目錄」，讓 `entries` literal / Regex 能在固定兩層內明確加入 non-repository；catalog 先解析 explicit entries 與 `hidden`，其餘預設 rows 才只保留`資料夾自己`帶 `.git` directory 或 file 的 Git repositories。第一層非 repo 只有在含有第二層 repo 時作為 category container 保留，第二層非 repo 一律省略；repository probe 失敗視為非 repo，併發上限 8，不得沿 parent repository 往上判定。Tree View、Quick Pick 與 Copy All Paths 必須共用這個 default projection。
- CLI Launcher 的 Focus list 只使用 `superset.cliLauncher.focused` exact literal paths，`superset.cliLauncher.focusedOnly` 是 application-scoped persistent toggle；不得加入 Regex、`globalState` 副本或另一套 discovery。Focus projection 必須在 explicit/hidden resolution 與 Git-only default projection 之後套用：保留 exact Focused paths，第二層命中時只額外保留必要的第一層 ancestor category，聚焦 ancestor 本身不得隱含聚焦 descendants。Tree View、Quick Pick 與 Copy All Paths 必須共用這個 projection；native Find query 仍只由 VS Code 擁有。Focused row 的 context value 只加 `.focused` suffix，讓 path edit menu 的 `Add to Focus List` / `Remove from Focus List` 互斥顯示，不得破壞既有 row actions。
- CLI Launcher 的命令參數以 duck typing（`toCLIEntry`）解析，不得改用 `instanceof`：命令參數跨過 VS Code menu 層後型別不保證同源，`instanceof` 會靜默失敗成「按了沒反應」。命令一律以 `resolveEntries` 解析成`一組` entries（`targets` → `target` → `view.selection` → quick pick），啟動、`Open in New Window`、Focus list mutation 與 `Remove from Panel` 共用同一條路徑：多選幾列，動作就套用到那幾列。`Open in New Window` 只委派 VS Code 開啟各 path，不建立 terminal 或改 settings；移除的確認對話只跳`一次`（多選只報數量），釘選列與掃描列可混在同一份選取，各自走 `entries` / `hidden`。只有 inline 按鈕維持單列語意（VS Code 不帶 `targets`）。
- CLI Launcher 的 path hotkeys 固定為 `Cmd+N` 開新視窗、`Ctrl+1` 開純 terminal、`Ctrl+2` / `Ctrl+3` / `Ctrl+4` 開 Claude / Codex / Grok。五者只在 CLI View focused、沒有 Input focus 且至少有一個 path selection 時啟用；只有 keyboard focus 不算 selection。`superset.cliLauncher.hasPathSelection` 只能由 Tree View selection event 維護，View activation 與 teardown 都必須清為 false；Command Palette、Context Menu 與 Inline Actions 不受此 hotkey gate 限制。
- CLI Launcher 的 `Create Subfolder` 同樣走 `resolveEntries`，多選只問一次名稱並在每個 path 建立同名 direct child。名稱 trim 後不得為空、`.`、`..`，也不得含 path separator 或 NUL；建立必須是 non-recursive，成功後只刷新 provider，不改 settings、不自動 pin、不建立 terminal。這是明確的 filesystem mutation，失敗必須走 diagnostic log 與可見 error boundary，不得與只改面板狀態的 `Remove from Panel` 混為同一種動作。
- CLI View Container 固定包含 `superset.cliLauncher.paths` 的 native `Repo Path` Tree View 與 `superset.cliLauncher.changes` 的 native `Change` Tree View。`Change` 只接受一個 normalized path selection；零選取與多選都不得猜 repository。explicit non-repository 仍可留在 `Repo Path`，但 `Change` 必須先以 path 自身 `.git` marker 守住 Git boundary。
- `Change` status 的唯一輸入是 NUL-delimited `git status --porcelain=v1 -z --untracked-files=all`；marker 固定為 `U` update、`A` newly added、`!` conflict、`D` deleted。Parser 不得以 newline 切 record，rename / copy 必須保留 original path；同一 path 同時存在 index 與 working-tree delta 時，必須分別投影到 staged 與 unstaged groups。
- `Change` 只顯示非空的 `Staged Changes`、`Unstaged Changes`、`Untracked Changes` top-level Tree Items，下一層依 repository-relative path 建立 compact folder/file hierarchy。Group、folder 與 file 都有 `Discard` 及對應的 `Stage` / `Unstage`，使用 native `view/item/context` 與 SCM-style `discard` / `add` / `remove` Codicons。Mutation 只接受目前 Extension Host 保存的 opaque node id，不接受 command argument 傳入 repository/path。`Discard` 先顯示單一 modal confirmation，untracked 與 newly staged files 使用 VS Code Trash。
- `Change` 不提供 commit-related title action。Commit input、message generation 與 Commit button 一律由 VS Code native Source Control 擁有；不得恢復 Superset-owned Input Box、commit draft、provider handoff、message-generation invocation 或 direct `git commit` path。
- Change Item 點擊開啟 group-aware Diff Editor：staged 是 `HEAD → index`、unstaged 是 `index → working tree`、untracked 是 `empty → working tree`。Virtual side 由 read-only content provider 供應，working side 使用 file URI；任何 relative path 必須先確認沒有逃出 selected repository。
- Superset 只有 `SuperSet` 與 `CLI` 兩個 View Container。TODO domain 只有一個面板、一組 `superset.todo*` 命令與一組 `todo*` context values，不得引入第二個 command prefix 或跨 `~/projects` 掃描。
- `TODO` 只認大小寫完全相符的 `README.todo`，掃描邊界固定是 current workspace root：root 為 depth 0，預設最大 depth 5（設定 `superset.todo.maxDepth`，範圍 1–10），命中後仍繼續掃描子孫。掃描不得越過 workspace root（不再有 `~/projects` 一覽）。
- `superset.openProject` 由 `src/todo/` 註冊，只服務 `todoProject` / `todoPlan` 兩種 row，`projectPath` 為空時必須早返 —— 合成的 wrapper row 帶空字串，直接開會落到 process cwd。
- 每列 mutation 一律走 `src/todo/storeDispatch.ts#invokeTodoStoreMutation`：`TodoStore` 的方法讀 `this.repository`，把方法取出來當裸函式呼叫會讓 receiver 消失。
- Plan item 是 read-only domain kind，不納入 pending task 計數。Overview 不再有 top-level merged Plans row；plans 只出現在對應 local/per-project scope。
- `src/sessions/` 不得改寫 ingest session content，唯一 content writer 是 `sample-*.jsonl` 假資料指令；`Clear Sample Sessions` 仍只清除該 prefix，不得批次影響 ingest sessions。`Delete Session` 則直接刪除所選 sample 或 ingest JSONL，不顯示 confirmation；`deleteSession` 必須在內部限制為 configured Sessions store 內的 `.jsonl`，不得只依賴 UI 傳入的 path。
- Sessions 的 Tree View 與 summary renderer 必須共用單一 `SessionStore`。cache 只在 `sizeBytes + mtimeMs` 同時相符時重用 parsed record，directory scan 必須淘汰已刪除檔案；recursive Store Watcher 只在 `Sessions View` visible 時存在。
- Summary markdown 的 heading 契約固定為 `#` session /`##` round /`###` tool，由 `markdown.ts` 單點決定。`##` 層級保留給「Round」序列使用；其他段落（含 Resume、Summary、Overview 等）一律降到 `###` 或更深，確保 VS Code outline 將 round 顯示為同一連續序列，不被同層插入的 heading 打斷。
- Editor Layout 的 sizing 規則是`固定`的：horizontal `even`、vertical `max`（`grid.ts#MAX_AXIS`）。不得回退成可選 mode —— 沒有 mode 就沒有 mode 記錄、沒有 status bar、沒有 picker/cycle/toggle 命令，`workspaceState` 不存任何 layout 狀態。決定某一層套用哪個 sizing 的是`該層的方向`而非深度：level 0 依 root `orientation`，以下逐層交替（`directionAt`）。不得加入沿路徑攤平的深度補償 —— 那會讓 `2×2` 的兄弟節點被壓到最小尺寸而看似消失。
- Editor Layout 只有四個命令：`Refresh`（唯一綁鍵，`Cmd+Alt+V`）、`Transpose`、`Pick/Reset Editor Grid Shape`。不得新增 status bar item —— 只有一種佈局時，狀態列指示沒有可顯示的狀態。

- 網格形狀 (grid shape) 與 root orientation 都與 sizing 規則正交，不得升格成可選模式。套用一律走`保形 (topology-preserving)` 的 `restyleLayout`，保留樹形與 orientation、只重寫各層 `size`；orientation 只由 `transpose` 改變。`buildLayout` 是唯一會改變格子數的路徑，只能從 shape pick / reset 進入，且必須先過 `reconcileShape` 讓 `sum(shape) === groupCount`（`vscode.setEditorLayout` 對 leaf 數不符會新建空 group 或 `mergeGroup` 既有 group）。
- `activeShare` 必須保證每個非作用中的兄弟至少留下 `MIN_SIBLING_SHARE`，並且不得小於均分值；同層兄弟過多時退化為均分。這是防止 `max` 把格子擠到 VS Code 最小尺寸而視覺上消失的第一道防線。
- 送進 `setEditorLayout` 的 `size` 必須是`與 getEditorLayout 相同量級的整數像素`，每個 sibling set 沿用該 set 現有的像素總量（無法取得時退回 `FALLBACK_SET_TOTAL`），由 `allocateSizes` 以最大餘數法分配且每格至少 1。不可送出加總為 1 的小數比例 —— `createSerializedGrid` 以 size 總和推導虛擬網格尺寸，小數會造出 `1x1` 的網格，每個 group 都低於最小尺寸而被 clamp，結果是兄弟看似消失但實際存在。
- 因為 size 是像素，`layoutSignature` 必須以`同層佔比`比較而非原始像素，否則視窗縮放或 ±1px 誤差會被誤判成待套用的變更。
- Editor Layout 的 `activeIndex` 只能來自 `activeTabGroup.viewColumn - 1`。`tabGroups.all` 是 group `建立順序`，descriptor 的 leaf 序是 `GRID_APPEARANCE` 深度優先順序，兩者在 split / 搬移後會分歧；用 `all.indexOf` 會放大錯誤的 group。
- Editor Layout 的 `Refresh` 是唯一的 reconcile 入口：`controller.reset()` 清掉 signature memo，再 `force` 重套；`superset.editorLayout.*` 的設定變更走同一條路徑（`affectsConfiguration` gate），因為設定變動不會產生任何 grid event，沒有這條線 `maxRatio` 改了也只會停在舊比例。Refresh 不寫入任何持久狀態。
- Editor Layout 的 signature guard 只比對`本次寫入 vs 上次寫入`，不得改成比對即時佈局 —— VS Code 會 clamp 最小寬高，requested 與 actual 本來就不同，比對即時佈局會讓 follow-active-group 無限重套。明確命令一律 `force`，事件驅動的重套才受 guard 約束。
- `orientation` 只在 root 生效，巢狀層自動垂直於父層；`size` 是同層相對值。方向命名與 VS Code 選單相反，見 [`docs/terminology.md`](docs/terminology.md)。
- `PluginManager` activation 失敗時必須立即 dispose 該 plugin 已註冊的 partial disposables 並移除 reset/diagnostics registration；root `deactivate()` 必須 await reverse teardown，再釋放 diagnostic channel。
- mDNS service、network-key secondary index 與 expiration cleanup 必須同步更新，避免 stale index 或錯誤合併。mDNS transport input 一律不可信：單包最多 `256` records、pending/store 各最多 `512` services、DNS name 最多 `255` UTF-8 bytes、alias/address/subtype 各最多 `32`、TXT 最多 `64` entries（key `128` bytes、value `1024` bytes），TTL 最高 `4500` 秒。
- `Connect Action` 必須先驗證 service type、DNS/IP target、port 與 SSH user。HTTP(S)/IPP(S) 只能走 `vscode.env.openExternal`；SSH 只能以 `cmd + args` plan 經 `joinShellCommand` 引用後進 terminal。mDNS payload 不得直接串接 shell command。
- Git hooks 只處理 `workspaceFolders[0]`；模板來源為 `pkg/resources/git/githooks/`。Install 採 copy-if-missing 後 Link，Status Bar 只做 Link；local `core.hooksPath` 只要非空即視為已連結。Repository 自用的 `.githooks/pre-push` 必須與內建模板保持一致。`pre-push` release tag 版本固定取 `max(最高 Git tag 的下一個 patch, package.json.version, .claude-plugin/plugin.json.version)`，缺少的 manifest 不納入候選。
- Projects Setup 固定以 `~/projects` 為 root，不提供自訂路徑；13 個 repository（包含 `social`）的 ordered set 以 `pkg/resources/config/setup-projects.sh` 為 runtime source of truth。首次 clone 必須使用 `--recurse-submodules`，重跑只補做 recursive submodule sync/update，不 pull 或覆蓋既有 repository。
- Extension 靜態資源統一放在 `pkg/resources/`；Git domain 模板放在 `pkg/resources/git/`。
- 純 domain logic 優先抽成無 `vscode` import 的函式或 store；VS Code-bound provider 以 pure renderer、contract test 或 activation test 覆蓋。

## 計劃與規格 (Plans vs Specs)

| 目錄 | 狀態 | 規則 |
| --- | --- | --- |
| `plans/` | 未解問題 / 驗收中 | 目前集中於單一 dated `Refresh`；完成後刪除對應問題 |
| `docs/specs/` | 現行設計 / 問題解法 | 目前集中於單一 dated `Summary`；被取代內容只由 Git history 追溯 |

## 測試 (Testing)

- `npm test` 跑完整 Vitest suite。
- `npm run build` 會 clean、`npm ci`、TypeScript compile、以 lockfile 內的 `@vscode/vsce` 打包 VSIX，最後執行 `scripts/verify-vsix.sh`。
- 修改 manifest、activation order、TreeView registration 或 VSIX 打包內容時，除 unit tests 外必須跑完整 build。
- 不在本檔維護易漂移的測試檔與 case 數；測試行為以 `test/` 與相關 specs 為準。

## GitHub Actions 發布 (Release)

- [`.github/workflows/release.yml`](.github/workflows/release.yml) 只在推送 `v<major>.<minor>.<patch>` tag 時執行。
- Tag 必須與 `package.json` 的版本完全相符；workflow 會執行 build、測試與 VSIX 驗證。
- Workflow 預設與 build job 只有 `contents: read`；checkout 不持久化 credentials。只有依賴 verified one-day artifact 的 release job 取得 `contents: write`，所有第三方 Actions 必須固定到完整 commit SHA。
- GitHub Release 只上傳單一固定檔名 `superset.vsix` asset，不上傳其他 build 產物。

## 設計與問題索引 (Design and Problem Index)

- 現行設計與已遇到的問題：[`docs/specs/2026-08-06-Summary.md`](docs/specs/2026-08-06-Summary.md)
- 尚未完成的驗收與目前問題：[`plans/2026-08-06-Refresh.md`](plans/2026-08-06-Refresh.md)
- Session JSONL 格式與 hook 事件：隨 `sessiond` 專案移至 [BizShuk/sessiond](https://github.com/BizShuk/sessiond)（[本地 `~/projects/tools/sessiond/docs/session/`](../../tools/sessiond/docs/session/)）

外部 API：

- [VS Code Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [VS Code Terminal API](https://code.visualstudio.com/api/references/vscode-api#window.createTerminal)
