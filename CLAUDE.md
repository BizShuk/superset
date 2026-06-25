# Superset 專案說明 (Project Notes)

VSCode 擴充功能:主側欄列出所有終端機,偵測背景終端機的新輸出並三處高亮(面板圖示、tab 名稱、狀態列)。本檔案記錄專案結構、建置指令與「為何這樣設計」的決策脈絡,作為日後維護與重構的依據。

> 對外文件 (功能描述、安裝、使用) 見 [`README.md`](README.md);設計決策歷史見 [`plans/`](plans/) (進行中計劃) 與 [`specs/`](specs/) (已實作的歷史規格)。

Update version in @package.json every change based on <majore,minor,patch>

---

## 與根 `CLAUDE.md` 的關係

本專案是 `vscode-plugin-experiment` 的子模組 (git submodule),位於 `superset/` 底下。

- 根 `../CLAUDE.md`:多專案聚合,定義 `md-tree-highlight` 等子模組的建置指令
- 本檔案 (`superset/CLAUDE.md`):`superset` 自己專屬的建置、TUI 偵測方案、版本紀錄

兩個檔案的「建置指令」段落不重複;本檔案只記 `superset/` 自己獨有的內容。

---

## 常用指令 (Commands)

從 `superset/` 目錄下執行:

| 動作                           | 指令                       |
| ------------------------------ | -------------------------- |
| 安裝相依套件 (第一次 / 更新後) | `npm install`              |
| 型別檢查 + 編譯                | `npm run build`            |
| 邊改邊編譯                     | `npm run watch`            |
| 跑單元測試                     | `npm test`                 |
| 持續跑測試                     | `npm run test:watch`       |
| 打包成 `.vsix`                 | `npx @vscode/vsce package` |

> `engines.vscode` 為 `^1.85.0`,需要 Shell Integration API 穩定後的版本。低於 1.85 收不到 shell execution 事件,終端機仍會列出但不會高亮。

---

## TUI 偵測方案對照 (TUI Detection Approaches)

「TUI 偵測」指:在背景終端機跑 TUI app (`claude`、`vim`、`htop` 等) 時,即時偵測到新輸出並高亮。TUI 的特性是「一次長跑 shell command + 全螢幕 ANSI redraw」,shell integration 的 `execution.read()` 對這類 raw PTY 串流解析不可靠,需要另尋事件源。

### 方案演進史

| 階段         | 方案                                                                         | 為何放棄                                                                                        |
| ------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1            | `vscode.window.onDidStartTerminalShellExecution` + `execution.read()`        | 對 TUI 長跑 command 解析不穩,redraw chunk 漏                                                    |
| 2a           | `window.onDidWriteTerminalData` (全域 PTY byte 事件)                         | 已是 **proposed API** (`terminalDataWriteEvent`),需 `enabledApiProposals` + 啟動旗標;用戶摩擦大 |
| 2b           | `Terminal.onDidWriteData` (per-terminal)                                     | 同樣 proposed API,但 lifecycle 對齊較乾淨                                                       |
| 3            | 輪詢 `terminal.buffer` 算 diff                                               | 公開 API 拿不到 `terminal.buffer`;xterm hack 維護成本高                                         |
| 4            | `vscode.Pseudoterminal` + `node-pty` + 手動命令                              | 只覆蓋用戶主動開的 terminal,普通 + 鈕仍漏 TUI                                                   |
| **5 (現行)** | **Auto-PTY**:`onDidOpenTerminal` 偵測非 PTY terminal → 自動替換成 PTY-backed | **全部新開 terminal 均完整攔截 TUI;`ptyBackedTerminals` Set 防止 infinite loop**                |

### 為何選方案 4 (PTY-backed terminals)

`★ 決策 ─────────────────────────────────────`

- **完全繞過 VSCode 抽象層**:VSCode 內建 terminal 的 PTY 在 renderer process,extension 拿不到。唯一 extension 拿得到 PTY 的方式是「自己開」 — 用 `vscode.Pseudoterminal` 接 `node-pty`。
- **不需 proposed API 旗標**:`Pseudoterminal` 是穩定 API,`node-pty` 是普通 npm 套件。沒有啟動摩擦。
- **TUI 100% 攔截**:`node-pty` 開 master 端給我們讀,所有 PTY write (含 TUI redraw) 一個不漏。
- **取捨 (方案 5)**:`onDidOpenTerminal` 自動替換新 terminal,但 activate 時已存在的 terminal 不置換(避免打斷用戶工作)。Pre-existing terminal 仍靠 `OutputWatcher` fallback。
  `─────────────────────────────────────────────`

升級路徑:若未來要讓「既有 VSCode 內建 terminal」也吃到 TUI 偵測,目前沒有穩定 API 可走(只能回頭用 proposed API)。在 VSCode 開放 PTY 公開 API 前,方案 4 是最務實的選擇。

---

## 架構速覽 (Architecture)

### Composition Root

`src/extension.ts` (~91 行) 是 composition root,只負責:

- 建立共享資源 (OutputChannel、StatusBar)
- 組裝 `FeatureContext`
- 依序呼叫各 feature module 的 `register()` 函式
- 註冊跨 feature 的 global commands (`focusView`、`showLogs`、`focusPanel`)

### Feature Modules

五個獨立 feature modules,每個都有統一的 `register(ctx: FeatureContext): FeatureHandle` 介面:

| 模組                          | 職責                                | 主要元件                                                  |
| ----------------------------- | ----------------------------------- | --------------------------------------------------------- |
| `features/terminals/index.ts` | 終端機面板 + 高亮 + PTY 自動替換   | TerminalRegistry, OutputWatcher, PtyTerminalHost, ...     |
| `features/explorer/index.ts`  | 檔案總管 TreeView                   | ExplorerStore, ExplorerTreeProvider                       |
| `features/mdns/index.ts`      | mDNS 服務發現 TreeView              | MdnsRegistry, MdnsTreeProvider                            |
| `features/topology/index.ts`  | 網路拓撲掃描 TreeView               | TopologyStore, TopologyTreeProvider                       |
| `features/todo/index.ts`      | TODO 清單 TreeView + 過濾器 badge   | TodoStore, TodoTreeProvider, computeTodoBadgeTitle(badge) |

---

## 計劃 vs 規格目錄 (plans/ vs specs/)

兩個目錄存放 markdown 文件,功能不同:

| 目錄        | 用途                                                | 何時放入                                                |
| ----------- | --------------------------------------------------- | ------------------------------------------------------- |
| `plans/`    | **進行中 / 未實作** 的設計與實作計劃                | 寫計劃時;feature 實作完成、push 成功後,搬到 `specs/` |
| `specs/`    | **已實作且 push** 的歷史規格文件(已不再變動的紀錄) | 對應功能 commit 進 git history 後                        |

`specs/` 內的檔案視為「事後記錄」,不再被當作進行中的計劃修改;新的變更以新 plan 形式開在 `plans/`,完成後整份升級進 `specs/`。

### Terminals Feature 內部元件

以 `TerminalRegistry` 為唯一資料來源:

| 元件                   | 職責                                      | 訂閱來源                           |
| ---------------------- | ----------------------------------------- | ---------------------------------- |
| `TerminalRegistry`     | 維護終端機清單與 unseen 旗標              | —                                  |
| `OutputWatcher`        | Shell Integration events → markUnseen     | `onDidStartTerminalShellExecution` |
| `PtyTerminalHost`      | 真實 PTY 寫入 → markUnseen (TUI 完整偵測) | 內部 `node-pty.spawn` 的 `onData`  |
| `TerminalTreeProvider` | TreeView 面板                             | registry                           |
| `HighlightPresenter`   | tab 名稱前綴 + 狀態列文字                 | registry                           |

兩個偵測來源並存,`registry.markUnseen` 是 idempotent,雙重觸發無副作用:

- **既有 VSCode terminal**:`OutputWatcher` 透過 shell integration 監聽,可能漏 TUI
- **`Superset: Open TUI Terminal` 開的 terminal**:`PtyTerminalHost` 透過自己握的 PTY 100% 攔截,適合跑 TUI

### `PtyTerminalHost` 生命週期

```
[1] 使用者執行「Superset: Open TUI Terminal」命令
    │
    ├── extension.ts 建 PtyTerminalHost(getTerminal=closure, spawn, ...)
    │       closure 此時指向 undefined
    │
    ├── extension.ts 用 host 組出 vscode.Pseudoterminal 物件
    │
    ├── vscode.window.createTerminal({ name: "Superset TUI", pty })
    │       ← closure 此時指向新建的 vscode.Terminal
    │       ← onDidOpenTerminal 事件觸發,terminal 進 registry
    │
    └── terminal.show() → 框架呼叫 pty.open(dims)
            │
            └── PtyTerminalHost.open() 呼叫 spawn → node-pty.spawn(shell, "-i", ...)
                    │
                    └── 後續所有 PTY write 都走 host.detectActivity()
                            → 若非 active → registry.markUnseen(terminal)
```

關鍵: `getTerminal: () => terminalRef` 是 closure,host 內部不直接持有 terminal 參考,而是延遲到第一次資料流入時再取。這避免「terminal 還沒建好就要 reference」的 chicken-and-egg。

### Agent-owned terminal 排除 (Antigravity)

某些 terminal 是其他 agent/extension 擁有的背景工作終端機 (background worker),不是給用戶操作的工作面 (work surface),出現在面板上只是雜訊。最典型的例子是 Antigravity 開出來的 `Antigravity Agent` terminal。

- **`shouldTrackTerminal(name)`** (`src/autoReplace.ts`):純函式,name 含 `antigravity` (case-insensitive) → 不進面板。在兩個入口 (pre-populate loop 與 `onDidOpenTerminal`) 都先過這道閘,被排除的 terminal 從不進 registry,因此沒有 row、沒有高亮、也沒有 PTY wrap。
- **與 `decideAutoReplace` 的關係**:`shouldTrackTerminal` 先跑,agent terminal 在 PTY-replace 決策前就被丟掉;`decideAutoReplace` 內仍保留同樣的 `/antigravity/i` 檢查作 defense-in-depth。
- 名稱匹配兩邊一致,新增同類 agent 時兩處一起改。

---

## `node-pty` 整合

`@homebridge/node-pty-prebuilt-multiarch` 是 `node-pty` 的 prebuilt fork,提供 macOS / Linux / Windows 的 prebuilt binary。`npm install` 時自動挑對應 platform 的 prebuild,不需本地 native build toolchain。

VSIX 大小影響:vsce 只打包當前 platform 的 prebuild (例如 macOS arm64 跑 package 只會包那個 .node 檔),跨平台 prebuild 留在 node_modules 但不會進 VSIX。目前本機 build 出的 VSIX 約 57 KB。

---

## mDNS 模組設計 (mDNS Module)

`MdnsRegistry` (`src/mdnsRegistry.ts`) 是純資料層:訂閱 `MdnsTransport`、解析 DNS-SD 記錄、用 observer pattern 對外發 `MdnsChange`。沒有 `vscode` import,可在純 Node 測試。

### 封包 → 合併 → 提交

- `handlePacket` 把一個 UDP datagram 內的 PTR/SRV/TXT/A/AAAA 記錄寫進 `pending: Map<instanceName, MutableService>`,250ms debounce 後 `flushPending` 一次凍結成 `MdnsService` 提交。同一 datagram 的多筆記錄合併成一個 service 才發事件,避免抖動。
- `services: Map<instanceName, MdnsService>` 以實例名稱為主鍵。

### 去重:network identity secondary key

- 同一台主機可能以多個 mDNS 實例名稱廣播、或同時走多張網卡 / IPv4+IPv6,造成面板重複列。`byNetworkKey: Map<host|port|type, canonicalName>` 為次索引;`flushPending` 提交時若新 service 的 network key 已存在於另一個實例名下,就 `mergeServices` 進該 canonical row(first-seen 名稱為準),其餘名稱存進 `service.aliases`,不再新增列。純函式 `networkKey` / `mergeServices` 在 `src/mdnsDedup.ts`。
- `canonKeyToNk` 反向索引讓「同一實例改 port」時能釋放舊 network-key 槽位,避免後續不同服務誤佔而假合併。
- `mergeServices` 同時聯集 addresses/subtypes、取 min ttl、取 max `lastSeen` / min `firstSeen` — 後者關鍵:新封包合併進 canonical 時不會留下過舊的 `lastSeen`,否則過期掃描會誤刪剛出現的服務。

### 過期:TTL grace period

- `services` 只增不減會讓面板塞滿已離線服務。`expireStale()` 每 `EXPIRY_TICK_MS`(5s)掃一次,`now - lastSeen > (ttl || TTL_DEFAULT_SECONDS) × 1000 × TTL_GRACE_MULTIPLIER`(3× TTL,RFC 6762 §10.1)就移除並發 `MdnsChange: "expired"` 事件。沒帶 TTL 的記錄 fallback 到 120s。持續收到封包的服務 `lastSeen` 不斷更新,永遠不過期。
- `MdnsChange` 多了 `expired` 變體(與 `removed` 區分:`removed` = transport 告知,`expired` = registry 自判),供監控/診斷用。`MdnsTreeProvider` 不分事件類型、只重抓 `getAll()`,故新增變體不影響消費端。
- `ClockSource`(預設 `Date.now`)為建構子選用依賴,測試以 `vi.useFakeTimers()` + 注入 `{ now: () => fakeNow }` 精確控制時間;正式環境呼叫端不變。
- 過期移除 canonical row 時同步清 `byNetworkKey` / `canonKeyToNk`,保持索引一致。

---

## 型別與 API 細節

### 為何 `TerminalHandle` 介面只有三個方法

`src/types.ts:1-6` 定義的 `TerminalHandle` 只 expose `name` / `show` / `dispose`。這是刻意的:

- 讓 fake terminal 在測試中容易構造 (見 `test/ptyTerminalHost.test.ts:11-13`)
- 避免把 deprecated / proposed API 變成核心契約
- 真實 `vscode.Terminal` 結構上滿足這個介面 (有更多方法但不衝突)

### `terminal.name` 在新版 VSCode 為 getter-only

`@types/vscode@1.85` 之後 `Terminal.name` 在 runtime 變 getter-only,`highlightPresenter.ts` 的 `nameWriteSupported` flag 自動降級到「面板 + 狀態列」模式 (見 `test/highlightPresenter.test.ts` 9 個 case 的倒數第二個)。

---

## 測試 (Testing)

`npm test` 跑 Vitest,目前 173 個 case 全綠:

| 測試檔                            | 對象                           | 案例數 |
| --------------------------------- | ------------------------------ | ------ |
| `terminalRegistry.test.ts`        | 純狀態機                       | 17     |
| `outputWatcher.test.ts`           | Shell Integration watcher      | 6      |
| `ptyTerminalHost.test.ts`         | PTY host (TUI 偵測核心)        | 15     |
| `treeProvider.test.ts`            | 面板渲染 (`buildTreeItemSpec`) | 11     |
| `highlightPresenter.test.ts`      | tab 前綴 + 狀態列 + 降級       | 11     |
| `badge.test.ts`                   | TODO badge 純函式              | 6      |
| `autoReplace.test.ts`             | PTY 替換決策 + agent 排除      | 11     |
| `groupStore.test.ts`              | 群組 metadata                  | 25     |
| `mdnsDedup.test.ts`               | mDNS 去重純函式                | 8      |
| `mdnsRegistry.test.ts`            | mDNS registry + 去重           | 15     |
| `mdnsRegistry.expiration.test.ts` | mDNS 服務過期                  | 8      |
| `mdnsTreeSpec.test.ts`            | mDNS 面板渲染 + 細節欄位       | 12     |
| `todoStore.test.ts`               | TODO store                     | 6      |
| `todoTreeProvider.test.ts`        | TODO 面板渲染                  | 17     |
| `topologyStore.test.ts`           | 拓撲掃描 store                 | 4      |
| `smoke.test.ts`                   | 整體 smoke                     | 1      |

`TerminalTreeProvider` class 本體 (vscode-bound) 不做單元測試,渲染邏輯已抽到 `src/treeSpec.ts` 純函式。

---

## 相關連結

- 設計規格(已實作): [`specs/2026-06-20-terminal-dashboard-panel.md`](specs/2026-06-20-terminal-dashboard-panel.md)
- 進行中計劃: [`plans/`](plans/)
- VSCode Terminal API 官方文件:<https://code.visualstudio.com/docs/terminal/shell-integration>
- VSCode Pseudoterminal:<https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal>
- node-pty:<https://github.com/homebridge/node-pty-prebuilt-multiarch>
