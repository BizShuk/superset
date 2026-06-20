# Superset: Close [X] button + Window detection

Date: 2026-06-20
Owner: extension author
Branch: feat/superset-panel

## 動機 (Motivation)

目前 `Superset` 面板列出所有「當前 window 開著的終端機」。使用者遇到的情境:

1. 終端機條目會一直留在面板上;`window.onDidCloseTerminal` 只在「使用者主動把終端機關掉」時才移除它。
2. 終端機雖然「還活著」(ex: 卡在互動式 REPL),但使用者想從面板移除 — 目前沒有任何 UI 入口。
3. 多 VSCode window 時,使用者無法從面板條目辨識「這個 panel 是哪個 window 的」。

## 範圍 (Scope)

新增 2 個能力:

- **A. Close [X] 按鈕** — 每個終端機條目在 hover 時,右側顯示一個 close icon。點擊 → 終端機 + 面板條目同時消失。
- **B. Window 識別** — TreeView 標題列顯示目前 window 的識別標籤 (8-char `vscode.env.sessionId`),讓多 window 使用者可區分。

## 不在範圍 (Out of Scope)

- 批次關閉多個終端機 (一次只能關一個)。
- 區分「關閉面板條目 vs 關閉終端機 process」兩個動作 — 本次只做「關終端機」,條目隨之消失。
- 跨 window 同步終端機清單 — VSCode `vscode.window.terminals` 限定當前 window,本次保持原樣。
- 取代原生 Terminal panel 的關閉按鈕 — 我們只在 dashboard panel 加。

## 設計決策 (Design Decisions)

### D1. [X] 按鈕 = inline context menu

VSCode `TreeItem` 沒有原生 close button。標準解法是 `package.json` 的 `menus.view.item.context`,搭配 `group: "inline"`。Hover 條目時,右側自動浮現 close icon;不需右鍵。

代價:VSCode 1.85+ 才支援 `group: "inline"` (我們 `engines.vscode` 已寫 `^1.85.0`)。

### D2. Window 識別 = TreeView `message`

`TreeView.message` 是標題列的灰色提示文字,適合顯示 "Window: abc12345"。比起把識別塞到每個 item description 裡更乾淨 — 既然 dashboard 內的 terminal 100% 屬於自己 window,逐項顯示是冗餘。

### D3. `terminal.dispose()` = `TerminalHandle.dispose()`

`vscode.Terminal` 公開 `dispose()` 來殺掉 process。把它拉進 `TerminalHandle` interface 是最小的介面破壞。其他純單元 (Registry / Watcher / Presenter) 都沒用到 dispose,只 extension.ts 的命令 handler 會呼叫。

### D4. 關閉後 registry 移除 = 命令 handler 主動呼叫

`vscode.window.onDidCloseTerminal` 在 dispose 後會觸發,所以 `extension.ts` 只需呼叫 `terminal.dispose()` 一次,registry 的 remove 由 lifecycle handler 負責 (避免雙重路徑)。

## 變更清單 (Changes)

| 檔案 | 變更 | 備註 |
|---|---|---|
| `src/types.ts` | `TerminalHandle` 加 `dispose(): void` | 介面擴充,所有 fake terminal 測試須補 dispose stub |
| `src/treeSpec.ts` | `buildTreeItemSpec` 加 `contextValue: "terminal"` 欄位;既有 `command` 不變 | 不破壞既有 4 個 test case |
| `src/treeProvider.ts` | constructor 加 `getWindowTag: () => string` 依賴;`getTreeItem` 設定 `contextValue`;`start()` 時設 `treeView.message` (但 treeView 由 extension.ts 建立,所以改成由 extension.ts 負責 message 設定,treeProvider 不動) | 維持 DI |
| `src/extension.ts` | 註冊 `superset.delete` 命令;treeView 建立後設定 `message` 為 `Window: <8-char sessionId>`;命令 handler 呼叫 `terminal.dispose()` | 純組裝層,無新邏輯 |
| `package.json` | contributes.commands 加 `superset.delete`;contributes.menus.view.item.context 加 inline entry (`when: viewItem == terminal`) | VSCode 1.85+ inline menu 標準模式 |
| `test/treeProvider.test.ts` | 加 1 個 test case: `buildTreeItemSpec` 回傳的 spec 含 `contextValue: "terminal"` | 既有 fake helper 不需變動 |
| `test/smoke.test.ts` | 不變 | 無相關 |

## 驗證 (Verification)

1. `npm test` — 既有 28 個 case 全綠,新增 1 個 case 也綠 → 共 29 個。
2. `npx tsc --noEmit` — 型別乾淨。
3. `npm run package` — VSIX 產出,大小 < 10 KB。
4. 手動 F5:開兩個 terminal → panel 各有一條,hover 時右側出現 close icon → 點擊其中一個 → terminal 真的關閉 + panel 那條消失。

## 風險 (Risks)

- `inline` menu group 在某些 VSCode 版本可能未生效 → 若 F5 看不到 icon,fallback 到右鍵選單 (去掉 `group: "inline"`) 仍可用。
- `vscode.env.sessionId` 跨重啟會變 → 預期行為,不是 bug。