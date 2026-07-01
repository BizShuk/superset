# Changelog

本檔案記錄 Superset 擴充功能各版本變更,格式參考 [Keep a Changelog](https://keepachangelog.com/),版本號依 [Semantic Versioning](https://semver.org/)。

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
