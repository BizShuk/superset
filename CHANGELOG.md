# Changelog

本檔案記錄 Superset 擴充功能各版本變更,格式參考 [Keep a Changelog](https://keepachangelog.com/),版本號依 [Semantic Versioning](https://semver.org/)。

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
