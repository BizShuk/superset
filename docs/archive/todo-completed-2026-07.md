<!--
此檔由 README.todo 自動歸檔,不要直接編輯;
若要查閱完成歷史用 git log 即可。
檔名格式:todo-completed-YYYY-MM.md,每月歸檔一次。
-->

# TODO 完成歷史 (Completed Archive)

下列項目均已實作並 commit 進 git history,版本見 commit log。

## 2026-07-05 批次

- [x] [P2] [feature] Default subgroup panel sizes — on first open, set panel heights: Terminals fixed at 200px, TODO expanded to fill remaining space (largest), mDNS/Topology collapsed.
- [x] [P2] [feature] `Superset: Reset All Caches` command — one-button wipe of `context.workspaceState` keys, mDNS in-memory cache, and `TopologyStore` state. Backs the "something's stale, start over" workflow; cheap (~30 LOC) and unblocks debugging. See scan note 2026-06-23#4U. [Reset All Caches 實作計畫 (Implementation Plan)](2026-06-24-feature-reset-caches.md)
- [x] [P1] [feature] TODO Markdown 預覽:CSS 摺疊與過濾 — 為 `README.todo` 內建預覽加純 CSS 互動 (`:has()` + checkbox hack),不開 Webview、零 preview JS。新 feature module `src/todoPreview/`,沿用 `treePreview` 的 markdown-it hook 路線. See [2026-07-01-feature-todo-css-preview.md](../specs/2026-07-01-feature-todo-css-preview.md).
    - [x] [P1] 共用前置:markdown-it `core` ruler `wrapSections` 把每個 heading section 包成 `.sec` 容器 (`data-title` + 每節唯一 id),抽純函式進 `sectionWrap.ts` 可單測
    - [x] [P1] 功能 1:一顆按鈕隱藏已完成 (`- [x]` `input:checked`)、刪除線 (`li:has(s)`)、`## Archive` 整區 (`.sec[data-title="Archive" i]`)
    - [x] [P1] 功能 2:每節從標題 `label` 點擊摺疊 (`.sec:has(.sec-tgl:checked) .sec-body`) + caret ▼/▶ 切換
    - [x] [P2] 功能 2b:master `fold all` / `unfold all` 按鈕 (OR 覆蓋語意,兩態文字 swap);「先全收再單獨展開」為 JS-only,不在此範圍
    - [x] [P2] filter bar:`core` ruler 於文件最前注 sticky 工具列,`styles/todo-preview.css` 加進 `package.json` `markdown.previewStyles`
    - [x] [P1] 接線:`extension.ts` `activate()` 包一層串接 `treePreview` + `todoPreview` 兩個 `extendMarkdownIt`
    - [x] [P2] 測試:`test/todoPreview.test.ts` 覆蓋 `sectionWrap` / filter-bar 純函式 (8 cases)
- [x] [P0] TODO subgroup panel add a button to open README.todo
- [x] [P1] deal with network topology routing parsing error (host ip adress is not listed in trace path) — `deriveLocalIp(interfaces, gateway)` 從 `listInterfaces()` + `getDefaultGateway()` 推導本機 IPv4 (優先 /24 subnet match,fallback 第一個非 internal IPv4);`TopologyStore.scan()` prepend 到 trace,description 顯示 `本機`. See [2026-06-30-topology-trace-local-ip.md](../specs/2026-06-30-topology-trace-local-ip.md).
- [x] [feature] mDNS detail-view query cache — `MdnsShowDetail` currently re-resolves on every invocation. Cache `buildMdnsDetailFields` output for 60s keyed by `${name}|${type}|${host}|${port}` to avoid spamming mDNS for already-seen services. Pairs with service expiration. See scan note 2026-06-23#3I.
- [x] [Bug] save README.todo with sub todo item (parent checked) will cause sub todo item auto marked as completed — TreeView 用 `manageCheckboxStateManually: true` 停掉框架的父→子勾選傳播 (`src/todo/index.ts`)
- [x] TODO subgroup banner `Open README.todo` button should open with markdown preview
- [x] [P1] markdown tree syntax: distinguish color for comment
- [x] Create highlight regex functionality
- [x] [P1] [feature] mDNS service dedup by `host|port|type` — multi-NIC / IPv4+IPv6 currently produce duplicate rows. `MdnsRegistry` upserts by name but not by network identity; add secondary key so the tree shows one canonical row per service. See scan note 2026-06-23#3J.
- [x] [feature] Terminal jump-to via `Superset: Go to Terminal` quick-pick — fuzzy pick of all open terminals, used as a `Ctrl+Shift+P` target. Composes with [terminal fuzzy search](2026-06-23-feature-terminal-fuzzy-search.md): the pick reuses the same `matchesTerminal` helper. See scan note 2026-06-23#2E.
- [x] deal with terminal "Antigravity Agent" terminal life cycle
- [x] [P1] [chore] topology 模組解耦與優化計畫實作 — 根據 [2026-07-02-architecture-topology.md](../specs/2026-07-02-architecture-topology.md) 進行 `topology` 模組的轉換解析層、狀態管理與命名風格對齊之拆分解耦
- [x] [P1] [chore] 整體擴充套件插件化與生命週期治理計畫實作 — 根據 [2026-07-02-architecture-pluginization.md](../specs/2026-07-02-architecture-pluginization.md) 進行 Composition Root 的解耦與模組插件化改進
- [x] [P1] [chore] VSCode baseline alignment — bump `engines.vscode` to `^1.90.0`
- [x] [P1] [chore] terminals 模組解耦與優化計畫實作
- [x] [P1] [chore] mDNS 模組解耦與優化計畫實作
- [x] [P1] [chore] 架構解耦與優化計畫實作 (todo 模組)
- [x] [P1] [chore] 整體系統架構整合與演進計畫實作 — version 0.6.0

## 2026-07-08 新增 (Stage 0-1 重整後)

- [x] `[P1] [feature] projectsTodo section pending badge` — 已在 stage 0 commit,plan 見 [2026-07-08-feature-projects-todo-section-pending-badge.md](../../plans/2026-07-08-feature-projects-todo-section-pending-badge.md)
- [x] plans/ docs/specs/ 檔名重整 (Stage 1) — 6 個 plans/ + 3 個 docs/specs/ 重命名為 `YYYY-MM-DD-<topic>.md`,見 commit history
- [x] `.vscodeignore` 補完 + `verify-vsix.sh` + 4 處 `console.log` 淨空 — Stage 3 + Stage E 合併 commit
- [x] `crossModuleState/` 目錄收口 — Stage D,3 處 module-level mutable state 集中管理
- [x] 移除 `treePreview/plugin.ts` `@deprecated` re-export + `scripts/for_loop.sh` — Stage F