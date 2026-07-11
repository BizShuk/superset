# Changelog

本檔案記錄 Superset 擴充功能各版本變更,格式參考 [Keep a Changelog](https://keepachangelog.com/),版本號依 [Semantic Versioning](https://semver.org/)。

## [0.10.4] - 2026-07-11

### Added

- 新 `Modified Files` panel 註冊於 VSCode 內建 Explorer 視圖(`views.explorer`):列出 modified / staged / deleted / renamed / untracked 檔案,資料夾階層樹狀,gitignore 由 `git status --porcelain` 自動處理 (含 nested `.gitignore` / `.git/info/exclude` / global ignore)。folder node 顯示 `M N · A N` 摘要,file row 顯示對應 ThemeIcon (M→`$(edit)`, A→`$(add)`, D→`$(trash)`, R→`$(diff)`, ?→`$(question)`)。
- FSW debounce 500ms 自動 refresh;10s `Promise.race` 熔斷避免 git status 卡死。
- 工具列按鈕 toggle Untracked 顯示/隱藏 (預設 ON)。
- 5 個新 commands: `refresh`, `toggleUntracked`, `revealInExplorer` (走 `revealFileInOS` 跨平台), `copyPath` (絕對), `copyRelativePath` (repo-relative)。

### Internal

- 新 `src/modifiedFiles/` feature-as-folder:`types.ts` / `gitStatusParser.ts` (純函式 porcelain 解析) / `treeBuilder.ts` (純函式 folder 樹狀化 + `statusSummary` 預計算) / `treeSpec.ts` (純函式 `TreeNode → TreeItemSpec`) / `modifiedFilesStore.ts` (FSW debouncer + git spawn orchestration) / `treeProvider.ts` (vscode.TreeDataProvider) / `commands.ts` / `index.ts` (composition root + `MessageOnlyProvider` fallback + `spawnExecFile` helper) / `plugin.ts` (ExtensionPlugin shim 對齊 `todoPlugin` 範式)。
- 新 30 個 vitest case:`gitStatusParser` 12、`treeBuilder` 10、`treeSpec` 8,加 1 個 plugin contract case。總計 610/610 tests passing (65 test files)。
- `extension.ts` plugin 陣列加 `modifiedFilesPlugin`(在 `projectsTodoPlugin` 之後、`globalCommandsPlugin` 之前)。
- `package.json` 加 `views.explorer`、`5 commands`、`view/title` 與 `view/item/context` menu 條目;version 0.10.3 → 0.10.4。
- 規格與計畫: `docs/specs/2026-07-11-modified-files-explorer-panel.md`、`plans/2026-07-11-modified-files-explorer-panel.md`。

## [0.10.0] - 2026-07-10

### Added

- 終端機偵測 `mermaid` 觸發關鍵字並開啟預覽:terminal 內出現獨立一行 `mermaid`(後接 diagram syntax 直到全空行)時,VSCode 會在 keyword 同一行加上 clickable link,點擊開啟預覽。預覽本身委派給使用者已安裝的 Mermaid Preview extension(如 `bierner.markdown-mermaid`);未安裝時降級為在新分頁開啟 source `.md` + 提示安裝。內部走 `MermaidLineBuffer`(per-terminal ring buffer 200 lines + ANSI strip)+ `MermaidTerminalLinkProvider`(`vscode.window.registerTerminalLinkProvider`),資料來源涵蓋 PTY-backed terminal(走 `PtyTerminalFactory.onData` 新增的 data fan-out)與 VSCode 內建 shell-integration terminal(走 `createShellExecutionChunkFanOut` 從 `execution.read()` 拉)。

### Internal

- 新 `src/terminals/mermaidTrigger.ts`(純函式 `findFirstMermaidMatch` / `findAllMermaidMatches`)、`mermaidLineBuffer.ts`、`mermaidLinkProvider.ts`、`mermaidPreviewCommand.ts`。
- `PtyTerminalFactory` 增加 `onData(cb)` fan-out 訂閱;`shellExecutionSource.ts` 增加 `createShellExecutionChunkFanOut`。
- `test/mermaidTrigger.test.ts` 12 case、`test/mermaidLineBuffer.test.ts` 11 case、`test/mermaidLinkProvider.test.ts` 7 case、`test/mermaidPreviewCommand.test.ts` 8 case 全綠;總計 568/568 tests passing (60 test files)。
- `package.json` 新增 `superset.mermaidPreview` command entry(無 keybinding,純 link click 觸發)。

## [0.9.2] - 2026-07-10

### Added

- 新 command `superset.installLicense`:從 QuickPick 挑選 Apache-2.0 / MIT / BSD-3-Clause,寫入 workspace 根目錄的 `LICENSE` 檔案 (year 用 `new Date().getFullYear()`,copyright holder 留 `[name of copyright owner]` placeholder 供使用者編輯)。若 `LICENSE` 已存在會跳 modal 詢問是否覆蓋;支援 `args.licenseId` / `args.force` 程式化呼叫 (可走未來的 TreeView menu)。

### Internal

- 新純資料模組 `src/licenseTemplates.ts`:`LicenseTemplate` / `LICENSE_TEMPLATES` / `findLicenseTemplate(id)`,Apache-2.0 / MIT / BSD-3-Clause 全文內嵌 (SPDX 標準文字,離線可用、不打網路)。
- `test/installCommands.test.ts` 新增 4 個 case (QuickPick 三選項 / 寫入內容 / 覆蓋確認 Cancel / 覆蓋確認 Overwrite / 程式化 `licenseId` + `force` 路徑)。

## [0.8.4] - 2026-07-09

### Added

- TODO 面板整合 `plans/` 資料夾掃描:local `TodoStore` 與跨專案 `ProjectsTodoStore` 都會平行掃 `<root>/plans/*.md`,把每份 `.md` 當作一個 read-only item 出現在「`## Plans`」合成 section 末端,點 row 右側的「Open」icon 開啟 markdown preview (與既有 `todoOpenLink` 同模式,不寫回檔案)。
- 新 `TodoItem.kind: "plan"` discriminated union + `filePath` 欄位 (在 `src/todo/types.ts`) — `applyPriorityFilter` 對 plan item 做 passthrough,所以 P0/P1/P2 filter 不會把 design doc 濾掉;File view 中 plan item 群組在 synthetic `plans/` 群組。
- `ProjectsTodoStore` 放寬專案識別為「有 `README.todo` 或 `plans/` 任一即算」,使 plans-only 專案 (沒 `README.todo` 但有 `plans/`) 也會出現在 Projects TODO 總覽,`New TODO` / `Open README.todo` 的 QuickPick 也涵蓋這些專案 (plans-only 會顯示「`僅有 plans/`」副標題)。
- 兩個新 command:`superset.todoOpenPlan` (local) 與 `superset.projectsTodoOpenPlan` (global),透過 `markdown.showPreview` 開啟 plan 檔案。
- 新 FileSystemWatcher:`plans/*.md` 在 local 與 `**/plans/*.md` 在 global,plans/ 變動時即時 reload 對應 store。

### Internal

- 新純函式模組 `src/todo/plansSource.ts`:`scanPlans(workspaceRoot)`、`PlanInfo` 型別、`planInfoToTodoItem()`、`makePlansSection()` helper (沿用 `parser.ts` 風格,無 `vscode` import,易測)。
- `TodoStore.load()` 改用 `Promise.all` 並行讀 `README.todo` 與 `plans/`,效能維持原狀。
- 既有 command handler 加 `kind === "plan"` / `text === "Plans"` guard,plan row 不會被誤套用 toggle/archive/priority/section/destroy 操作。
- 15 個新 test case (`plansSource.test.ts`:`scanPlans` / `extractTitle` / `basenameFallback` / `planInfoToTodoItem` / `makePlansSection` 完整覆蓋);既有 417 case 全綠,總計 432 case / 46 test file。

## [0.6.0] - 2026-07-02

### Changed

- 整體系統架構整合釋出 (`PluginManager` 統一治理 + 六階段模組解耦):`extension.ts` 從 172 行縮為 94 行 declarative composition root;新增 `src/plugin/{manager,context,types,index}.ts` 框架,所有 feature module (terminals / mdns / topology / todo / todoPreview / treePreview / globalCommands) 透過 `ExtensionPlugin` 介面註冊;`activateAll` 對每 plugin 獨立 try-catch 錯誤邊界 (`plugin.failed.*` workspaceState 標記),單一模組啟動失敗不再中斷整個 extension。
- `todo` 模組拆為 SRP 對齊三層:`parser.ts` (純函式 `parseTodoFile`) + `repository.ts` (唯一接觸 `fs/promises`) + `todoStore.ts` (純記憶體狀態 + observer),既有 25 個 `TodoStore` 黑箱測試未改任何一行即全綠。
- `mdns` 模組拆為 SRP 對齊三層:`parser.ts` (純函式 `applyPtr/Srv/Txt/Address` + subtype/TTL helpers) + `store.ts` (`services` Map + `byNetworkKey` secondary index + `DetailCache`) + `expiration.ts` (TTL grace-period sweeper,支援 `ClockSource` 注入);`mdnsRegistry.ts` 從 487 行縮為 252 行 thin coordinator。
- `topology` 模組:`topology/transformer.ts` 純函式拆自原 171 行 God Function;`topology/topologyStore.ts` 改為 thin coordinator,新增 `SCAN_TIMEOUT_MS = 10_000` 熔斷防呆;命名對齊 `treeProvider.ts` / `treeSpec.ts`。
- `terminals` 模組:新增 `plugin.ts` shim 對接 PluginManager;新增 `test/ptyProcessContract.test.ts` 12 case 獨立鎖定 `PtyProcess` 介面契約 (`open` / `handleInput` / `setDimensions` / `close` 冪等 / `markUnseen` 觸發條件)。
- `src/globalCommandsPlugin.ts` 獨立:聚合 `resetCaches` / `focusView` / `showLogs` / `focusPanel` 跨切指令,透過 `PluginContext.registerResetHandler` 對接 `manager.resetAll()`。

### Added

- `docs/specs/2026-07-02-architecture-master.md` 歸檔 master 架構計劃 (原 `plans/architecture-master.md`)。對應 commit: [`6b76ca1`](https://github.com/BizShuk/superset/commit/6b76ca1bda56ea3fabe61c291116c4cee9671436) feat: implement plugin architecture with mDNS discovery, topology visualization, and todo preview features。

### Internal

- 6 個 P1 架構任務從 `README.todo`「Architecture」段標記為完成 (`整體系統架構整合` / `架構解耦` / `mDNS 模組解耦` / `terminals 模組解耦` / `topology 模組解耦` / `整體插件化治理`)。
- 39 個 test file / 358 個 test case 全綠 (`vitest run`);`tsc --noEmit` 編譯乾淨。

> **歷史落後提示 (Historical gap):** 本檔案自 `[0.1.3]` (2026-06-25) 後未持續更新,0.2.x ~ 0.5.x 期間共約 25 個 PR 的功能 / 修補 / 架構演進未補入 CHANGELOG。本次釋出僅記錄 0.6.0 架構整合里程碑;歷史條目回填為獨立工作項。

## [0.1.3] - 2026-06-25

### Fixed

- 點擊狀態列 (status bar)「N 個終端機有新輸出」通知現在會跳轉到終端機面板。`superset.focusView` 先前綁定未註冊的 command `workbench.view.superset`(`executeCommand` 靜默無效,點擊無反應),修正為 `workbench.view.extension.superset` 開啟 container 後再 `superset.terminals.focus` 聚焦終端機面板。

## [0.1.2] - 2026-06-25

### Changed

- 活動列 (Activity Bar) 圖示 hover 顯示名稱:`Terminals` → `SuperSet`(`viewsContainers.activitybar.title`)。
- 側面板頂端標題:`Superset` → `SuperSet`(五個 view 的 `contextualTitle`)。

## [0.1.1] - 2026-06-25

### Changed

- 將 extension 重構為模組化架構 (feature registration pattern):`src/extension.ts` 縮減為 composition root,功能拆成五個獨立 feature modules(`terminals`、`explorer`、`mdns`、`topology`、`todo`),各自暴露統一的 `register(ctx): FeatureHandle` 介面。

### Internal

- 拆分文件目錄:`plans/` 改為存放「進行中 / 未實作」計劃,新增 `specs/` 存放「已實作且 push」的歷史規格(8 份已實作 plan 遷入);同步更新 `CLAUDE.md`、`README.md` 引用。

## [0.1.0] - 2026-06-23

### Added

- 未來功能與重構的實作計劃文件 (`plans/`)。

## [0.0.1] - 2026-06-20

### Added

- 初始版本:主側欄 (Primary Side Bar)「Terminals」面板,列出所有終端機;背景終端機有新輸出時,在面板、終端機分頁名稱、狀態列三處高亮,聚焦後自動解除。
- PTY-backed TUI 偵測:命令 `Superset: Open TUI Terminal` 透過 `node-pty` 100% 攔截 `claude`、`vim`、`htop` 等 TUI app 輸出。
- 終端機分群 (grouping):階層式 group、顏色標記、新增 / 重新命名 / 設色 / 刪除 / 收合。
- 各終端機穩定 string id。
- Explore、MDNS 子面板 TreeView。
- mDNS 服務模型擴充(`priority`、`weight`、`TTL`、`source address`)+ 服務詳細檢視與值複製。
- 網路拓撲掃描 (topology) 服務。
- TODO 管理模組:巢狀項目、完成項過濾 toggle、過濾器 badge。
- VSCode build task 設定 (`.vscode/tasks.json`)。
