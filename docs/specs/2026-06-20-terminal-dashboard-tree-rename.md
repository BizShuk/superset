# Superset: single-window tree + rename/kill context menu

Date: 2026-06-20
Owner: extension author
Status: implementation pending

## 動機 (Motivation)

User 觀察到的不足:

1. 目前 `getChildren()` 直接回傳 flat list,沒有「目前是哪個 window 的 panel」這個語意。
2. 想從 panel 直接改 terminal 名字 — 目前只能 `Ctrl+Shift+P` → Rename Terminal,沒辦法在 panel 右鍵觸發。
3. 點 [X] 雖然能關閉,但選單上寫 "Delete" 不夠直觀,user 偏好 "Kill" (意指 force dispose)。

## 範圍 (Scope)

### In scope (this iteration)

- **Tree hierarchy**: panel 變成兩層 — root 是單一 window group (label: `Window: <sessionId 前 8 碼>`),leaves 是 terminal。
- **Right-click menu items**:
    - `Rename Terminal` (新增)
    - `Kill Terminal` (取代 `Close Terminal` 的 menu label,行為都是 `terminal.dispose()`)
- 保留 [X] inline button (group: "inline" 還在,只是 command label 改成 "Kill Terminal" 比較語意一致)

### Out of scope (decided not to do this iteration)

- Multi-window 跨 window 列舉 — VSCode API 沒支援,user 接受 single-window。
- Editor group / panel 分組 — `vscode.Terminal` 沒有位置 API,無法分組。
- TUI 偵測加強 — user 確認現狀 OK,不動。

## 設計決策 (Design Decisions)

### D1. Window group node — foldable, default expanded

`vscode.TreeItemCollapsibleState.Expanded` 作為預設 (user 開 panel 就是要看 terminal,預設展開省一次點擊)。User 想摺疊就手動點,我們不存狀態 (沒必要持久化)。

### D2. Rename 實作 = `showInputBox` 而非 dispatch `workbench.action.renameTerminal`

後者操作 active terminal,需要先把目標 terminal show() 變 active (會搶 focus),而且不接受參數。前者:

```ts
const newName = await vscode.window.showInputBox({ value: terminal.name });
if (newName && newName !== terminal.name) {
    (terminal as unknown as { name: string }).name = newName;
    treeProvider.refresh(); // 立即更新 label
}
```

代價:多寫 5 行,但不會偷 focus。

### D3. Kill = Delete 行為,只換 label

`terminal.dispose()` 是唯一會 kill process 的 API,跟 [X] 按鈕是同一個動作。差別只在 menu 文字 — 讓 user 在右鍵選單看到 "Kill" 比 "Delete" 更貼近 terminal 語意。Command ID 仍叫 `superset.delete` 避免改 ID 造成 binding 失效。

### D4. Tree element 型別 = discriminated union

```ts
type TreeElement =
    | { kind: "window"; tag: string }
    | TerminalHandle;
```

`getChildren()` 根據 element 決定回傳 — undefined → [window group]; window group → terminals; terminal → []。

### D5. Window group tag 從 DI 注入,testable

跟既有 `treeProvider` 一致,constructor 接受 `getWindowTag: () => string`。`treeSpec.ts` 的 `buildWindowGroupSpec(tag)` 是純函式,可在 vitest 直接測。

## 變更清單 (Changes)

| 檔案 | 變更 | 測試 |
|---|---|---|
| `src/types.ts` | 加 `WindowGroupNode` type,擴充 `TreeElement` union | — |
| `src/treeSpec.ts` | 新增 `buildWindowGroupSpec(tag)`,回傳 `TreeItemSpec` 變體 (含 `collapsibleState`);既有 `buildTreeItemSpec` 行為不變 | 加 1 case: `buildWindowGroupSpec` 預設 expanded |
| `src/treeProvider.ts` | 改 `getChildren(element?)` 為分層;`getTreeItem` 處理兩種 element;constructor 加 `getWindowTag` 依賴 | — (vscode-bound,既有測試不覆蓋 class) |
| `src/extension.ts` | 註冊 `superset.rename` 命令 (showInputBox);把 `superset.delete` 的 title 從 "Close Terminal" 改成 "Kill Terminal";傳 `getWindowTag` 給 treeProvider | — |
| `package.json` | `menus.view.item.context` 加 `superset.rename` entry (group: `1_modify`);既有 delete entry 不變 | — |
| `test/treeProvider.test.ts` | 加 2 case: `buildWindowGroupSpec` 預設 expanded + label 包含 tag | — |
| `test/terminalRegistry.test.ts` / `outputWatcher.test.ts` / `highlightPresenter.test.ts` | 不變 (registry 介面沒動) | — |

## 驗證 (Verification)

1. `npm test` — 既有 29 個 + 新增 2 個 = 31 個,全綠
2. `npx tsc --noEmit` — clean
3. F5 手動測:
    - 開 2 個 terminal → panel 看到 `Window: abc12345` 一個 group,下面 2 個 terminal
    - 點 group header → 摺疊/展開切換
    - 右鍵 terminal → 看到 Rename + Kill Terminal
    - 點 Rename → input box 出現 (不搶 focus) → 改完 name 立即更新
    - 點 Kill → terminal 關閉 + 從 panel 消失

## 風險 (Risks)

- `(terminal as unknown as { name: string }).name = name` 是 escape hatch,VSCode 沒有 public setter。但 HighlightPresenter 已經用了同一招,所以技術債一致。
- `getWindowTag` 依賴是 closure 從 extension.ts 注入,如果 future code 直接 `new TerminalTreeProvider(registry)` 而沒傳 tag,會 NPE — 用 required 參數讓 TS 強制傳。

## Git 處置 (Git disposition)

`superset/` 在 `ef7da79` 被 untrack 進 parent repo 的 `.gitignore`。這次 feature 變更:

- **不會** 自動 commit 到 parent repo (因為 .gitignore 擋住)
- **working tree 留著**,user 仍可在 `superset/` 內 `git init` 一個新 repo 收納這些變更
- 若 user 想把 parent repo 的 `.gitignore` 拿掉讓 parent 繼續 track,只要刪掉那行就行 (但這違背上一個 turn 的決策)
