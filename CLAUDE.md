# Superset 專案說明 (Project Notes)

VSCode 擴充功能:主側欄列出所有終端機,偵測背景終端機的新輸出並三處高亮(面板圖示、tab 名稱、狀態列)。本檔案記錄專案結構、建置指令與「為何這樣設計」的決策脈絡,作為日後維護與重構的依據。

> 對外文件 (功能描述、安裝、使用) 見 [`README.md`](README.md);設計決策歷史見 [`plans/`](plans/)。

---

## 與根 `CLAUDE.md` 的關係

本專案是 `vscode-plugin-experiment` 的子模組 (git submodule),位於 `superset/` 底下。

- 根 `../CLAUDE.md`:多專案聚合,定義 `md-tree-highlight` 等子模組的建置指令
- 本檔案 (`superset/CLAUDE.md`):`superset` 自己專屬的建置、TUI 偵測方案、版本紀錄

兩個檔案的「建置指令」段落不重複;本檔案只記 `superset/` 自己獨有的內容。

---

## 常用指令 (Commands)

從 `superset/` 目錄下執行:

| 動作 | 指令 |
|---|---|
| 安裝相依套件 (第一次 / 更新後) | `npm install` |
| 型別檢查 + 編譯 | `npm run build` |
| 邊改邊編譯 | `npm run watch` |
| 跑單元測試 | `npm test` |
| 持續跑測試 | `npm run test:watch` |
| 打包成 `.vsix` | `npx @vscode/vsce package` |

> `engines.vscode` 為 `^1.85.0`,需要 Shell Integration API 穩定後的版本。低於 1.85 收不到 shell execution 事件,終端機仍會列出但不會高亮。

---

## TUI 偵測方案對照 (TUI Detection Approaches)

「TUI 偵測」指:在背景終端機跑 TUI app (`claude`、`vim`、`htop` 等) 時,即時偵測到新輸出並高亮。TUI 的特性是「一次長跑 shell command + 全螢幕 ANSI redraw」,shell integration 的 `execution.read()` 對這類 raw PTY 串流解析不可靠,需要另尋事件源。

### 方案演進史

| 階段 | 方案 | 為何放棄 |
|---|---|---|
| 1 | `vscode.window.onDidStartTerminalShellExecution` + `execution.read()` | 對 TUI 長跑 command 解析不穩,redraw chunk 漏 |
| 2a | `window.onDidWriteTerminalData` (全域 PTY byte 事件) | 已是 **proposed API** (`terminalDataWriteEvent`),需 `enabledApiProposals` + 啟動旗標;用戶摩擦大 |
| 2b | `Terminal.onDidWriteData` (per-terminal) | 同樣 proposed API,但 lifecycle 對齊較乾淨 |
| 3 | 輪詢 `terminal.buffer` 算 diff | 公開 API 拿不到 `terminal.buffer`;xterm hack 維護成本高 |
| **4 (現行)** | **`vscode.Pseudoterminal` + `node-pty`** | **新命令 `Superset: Open TUI Terminal` 開啟 PTY-backed terminal,內部用 `node-pty` spawn shell,所有 byte 走自己攔截** |

### 為何選方案 4 (PTY-backed terminals)

`★ 決策 ─────────────────────────────────────`
- **完全繞過 VSCode 抽象層**:VSCode 內建 terminal 的 PTY 在 renderer process,extension 拿不到。唯一 extension 拿得到 PTY 的方式是「自己開」 — 用 `vscode.Pseudoterminal` 接 `node-pty`。
- **不需 proposed API 旗標**:`Pseudoterminal` 是穩定 API,`node-pty` 是普通 npm 套件。沒有啟動摩擦。
- **TUI 100% 攔截**:`node-pty` 開 master 端給我們讀,所有 PTY write (含 TUI redraw) 一個不漏。
- **取捨**:只能用在「使用者主動用本命令開啟的 terminal」。既有 VSCode 內建 terminal (從 + 鈕開的那些) 仍只能靠 `OutputWatcher` 監聽,可能漏 TUI。
`─────────────────────────────────────────────`

升級路徑:若未來要讓「既有 VSCode 內建 terminal」也吃到 TUI 偵測,目前沒有穩定 API 可走(只能回頭用 proposed API)。在 VSCode 開放 PTY 公開 API 前,方案 4 是最務實的選擇。

---

## 架構速覽 (Architecture)

五個獨立單元,以 `TerminalRegistry` 為唯一資料來源:

| 元件 | 職責 | 訂閱來源 |
|---|---|---|
| `TerminalRegistry` | 維護終端機清單與 unseen 旗標 | — |
| `OutputWatcher` | Shell Integration events → markUnseen | `onDidStartTerminalShellExecution` |
| `PtyTerminalHost` | 真實 PTY 寫入 → markUnseen (TUI 完整偵測) | 內部 `node-pty.spawn` 的 `onData` |
| `TerminalTreeProvider` | TreeView 面板 | registry |
| `HighlightPresenter` | tab 名稱前綴 + 狀態列文字 | registry |

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

---

## `node-pty` 整合

`@homebridge/node-pty-prebuilt-multiarch` 是 `node-pty` 的 prebuilt fork,提供 macOS / Linux / Windows 的 prebuilt binary。`npm install` 時自動挑對應 platform 的 prebuild,不需本地 native build toolchain。

VSIX 大小影響:vsce 只打包當前 platform 的 prebuild (例如 macOS arm64 跑 package 只會包那個 .node 檔),跨平台 prebuild 留在 node_modules 但不會進 VSIX。目前本機 build 出的 VSIX 約 57 KB。

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

`npm test` 跑 Vitest,目前 48 個 case 全綠:

| 測試檔 | 對象 | 案例數 |
|---|---|---|
| `terminalRegistry.test.ts` | 純狀態機 | 14 |
| `outputWatcher.test.ts` | Shell Integration watcher | 5 |
| `ptyTerminalHost.test.ts` | PTY host (TUI 偵測核心) | 14 |
| `treeProvider.test.ts` | 面板渲染 (`buildTreeItemSpec`) | 5 |
| `highlightPresenter.test.ts` | tab 前綴 + 狀態列 + 降級 | 9 |
| `smoke.test.ts` | 整體 smoke | 1 |

`TerminalTreeProvider` class 本體 (vscode-bound) 不做單元測試,渲染邏輯已抽到 `src/treeSpec.ts` 純函式。

---

## 相關連結

- 設計規格:[`plans/2026-06-20-terminal-dashboard-panel.md`](plans/2026-06-20-terminal-dashboard-panel.md)
- VSCode Terminal API 官方文件:https://code.visualstudio.com/docs/terminal/shell-integration
- VSCode Pseudoterminal:https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal
- node-pty:https://github.com/homebridge/node-pty-prebuilt-multiarch
