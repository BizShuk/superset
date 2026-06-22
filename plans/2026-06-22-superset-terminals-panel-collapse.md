# Superset 側欄可收合 Panel:Terminals 第一輪 設計 (Design)

> **範圍限制 (Scope Lock):** 本 spec 只處理「整個 Terminals view 區塊可收合 + 為後續 mDNS section 預留容器」,不含 mDNS 偵測、不含 ping 健康檢查、不含 group drag-and-drop 之外的進階 UI。
>
> 同一個 brainstorming cycle 衍生的另外兩個子任務(mDNS 偵測面板、10 分鐘 ping 健康檢查)在後續 spec 處理。

---

## 1. 目標 (Goal)

在不改變既有終端機偵測鏈(`OutputWatcher` + `PtyTerminalHost` + `HighlightPresenter`)的前提下,把 `superset` viewContainer 內的 `superset.terminals` 從「VSCode 內建 TreeView」改為「自繪 WebviewView」,達到:

1. **整個 view 區塊可收合** — 點 section 標題列的 ▶/▼ 切換;收合時 body 完全隱藏。
2. **摺疊狀態持久化** — 用 `context.workspaceState` 記住,跨 VSCode 重啟恢復。
3. **為 mDNS section 預留容器** — 本輪先建立「多 section 容器」的擴充點;第二輪新增 `superset.mdns` view 即可掛上去,各自獨立收合。

---

## 2. 為何這樣設計 (Rationale)

### 2.1 為何從 TreeView 改 WebviewView

VSCode 1.85+ 的 `vscode.TreeView` 沒有「view 層級可收合」API;最低高度約 30px,無法滿足「整個 view 區塊可收合」。`WebviewView` 內部用 HTML/CSS 自行渲染,body 可設 `display: none`,完整達成收合需求。雖然要重寫既有 tree 渲染邏輯,但抽成「純函式 + JSON 訊息契約」後比現有 `treeProvider.ts` 更易測試(不需要 mock vscode、不需要 mock DOM)。

### 2.2 為何不雙軌(TreeView 保留 + WebviewView shell 包裹)

雙軌會造成「點 section 標題展開後,還要再點一次到另一個 view 才能看到 tree」,UX 不直覺。

### 2.3 為何不用方案 B (TreeView 內容層模擬收合)

最低高度 30px 的限制使「view 收合」變成「view 變空」,不是同一件事。

### 2.4 為何摺疊狀態用 `workspaceState` 而非 `webviewState`

`webviewState` 只存在於 webview 本身,重開 VSCode 視窗後丟失。`workspaceState` 是該視窗級的持久化層,符合「使用者希望自己的折疊習慣被記住」的語意。

---

## 3. 架構 (Architecture)

### 3.1 三層結構

| 層級 | 元件 | 職責 |
|---|---|---|
| **資料層** (Extension Host,既有) | `TerminalRegistry` | 終端機清單 + unseen 旗標 (不動) |
| | `GroupStore` | 群組 / 排序 / 收合狀態 (不動) |
| | `PanelStore` (**新**) | Side panel 視窗級狀態:每個 section 的 `collapsed` 旗標,持久化到 `context.workspaceState` |
| **協議層** (Extension Host ↔ Webview) | `panelProtocol.ts` (**新**,純模組) | 定義 message 介面 + type discriminator |
| | `buildTreeSnapshot(registry, groupStore)` (**新**,純函式) | 把 registry + groupStore 投影成可序列化的 snapshot(JSON) |
| **渲染層** (Webview) | `panel.html` + `panel.js` (**新**) | HTML/CSS/JS 渲染多 section(本輪只 Terminals);row click → 發 `focus` command;drag-and-drop 用 HTML5 API → 發 `moveTerminal` command |

### 3.2 組裝層改動

**刪除**
- `vscode.window.createTreeView('superset.terminals', ...)` 整段
- `TerminalTreeProvider` 的組裝 (該 class 仍可保留,純函式 `buildTreeItemSpec` 仍可用於 view title icon 計算)

**保留**
- `TerminalRegistry`、`GroupStore`、所有命令、`HighlightPresenter`、`OutputWatcher`、`PtyTerminalHost`
- 既有測試不動,個別 5 個 `treeProvider.test.ts` cases 改測 `buildTreeSnapshot` 等新純函式

**新增**
- `vscode.window.registerWebviewViewProvider('superset.terminals', new PanelViewProvider(...))`
- `superset.toggleTerminalsCollapsed` 命令,對應 `menus.view/title` 的 navigation button,icon 動態切換 `$(chevron-up)` / `$(chevron-down)`

### 3.3 與 `HighlightPresenter` 的分工

| 通道 | 誰負責 |
|---|---|
| Tab 名稱前綴 `● ` | `HighlightPresenter` (不動) |
| 狀態列文字 `N 個終端機有新輸出` | `HighlightPresenter` (不動) |
| Panel 內 unseen badge | `PanelView` 渲染時讀 `buildTreeSnapshot` 帶的 `unseen` 旗標 |
| Group 標題列聚合 unseen 計數 | 同上 |

### 3.4 終端機身份 (terminalId)

`vscode.Terminal` 物件無法 JSON 序列化 → webview ↔ host 用「穩定字串 ID」指認。**策略**:`registry` 內每個 `Entry` 帶 `id: string`,在 `add()` 時用反射讀取 `terminal.processId`(型別未公開)當 ID;反射失敗時 fallback 用 `` `t-${Date.now()}` ``。close 時 `registry.remove` 同步刪除 entry,ID 隨之釋放,沒有 stale 風險。

> 反射讀取需注意:`TerminalHandle` 介面不暴露 `processId`,因為它是 `vscode.Terminal` 的非契約屬性。實作為 `(terminal as unknown as { processId?: number }).processId?.toString()`,assembly 層不需改契約。

---

## 4. 資料流 (Data Flow)

### 4.1 啟動

```
extension.ts
  ↓ new PanelStore(context.workspaceState)             ← 讀既有 collapsed 狀態
  ↓ new PanelViewProvider(registry, groupStore, panelStore, diag.log)
  ↓ vscode.window.registerWebviewViewProvider('superset.terminals', provider)
  ↓
vscode 首次顯示 → provider.resolveWebviewView()
  ↓
  provider 註冊 webview.onDidReceiveMessage(handler)   ← 收到 webview 訊息
  provider 註冊 registry.onDidChange / groupStore.onDidChange / panelStore.onDidChange
  等待 webview 送出 'webviewReady' → host post 'init'
```

### 4.2 穩態事件

| 事件 | 流向 | 動作 |
|---|---|---|
| 開新 terminal | VSCode → `onDidOpenTerminal` → `registry.add` | `registry` 觸發 `added` → provider `webview.postMessage({type: 'snapshot', snapshot})` |
| 終端機有 unseen 輸出 | `OutputWatcher` / `PtyTerminalHost` → `registry.markUnseen` | `registry` 觸發 `unseenChanged` → 同上推 snapshot |
| 點 panel 上的 terminal row | webview → host: `focus` | handler `terminal.show()`;`onDidChangeActiveTerminal` 觸發 `registry.clearUnseen` → 推 snapshot |
| 點 panel 上 group 的 ▶/▼ | webview → host: `toggleGroup` | `groupStore.toggleGroupCollapsed` → 推 snapshot |
| 點 panel 上 section 的 ▶/▼ | webview 內部 display:none + host: `toggleSection` | `panelStore.setCollapsed` → 持久化 |
| 命令面板 `Superset: Toggle Terminals` | `superset.toggleTerminalsCollapsed` | `panelStore.toggle('terminals')` → 推 `collapseChanged` 廣播 |
| 拖曳 terminal 到 group | webview HTML5 dragstart/drop | host: `moveTerminal` → `groupStore.moveTerminalToGroup` |
| 拖曳 group 排序 | 同上 | host: `moveGroup` → `groupStore.moveGroup` |

### 4.3 訂閱生命週期

- `PanelViewProvider` 在 `resolveWebviewView` 內建立所有 `onDidChange` 訂閱
- `webviewView.onDidDispose` 觸發時 `unsubscribeAll()` 釋放
- 不在 `resolveWebviewView` 之外主動持有 `WebviewView` 參考

---

## 5. 訊息契約 (Message Protocol)

所有訊息走單一 channel,`type` 為 discriminator。

### 5.1 Host → Webview

```typescript
type HostMessage =
  | { type: 'init'; snapshot: TreeSnapshot; sections: SectionState[] }
  | { type: 'snapshot'; snapshot: TreeSnapshot }
  | { type: 'collapseChanged'; sectionId: SectionId; collapsed: boolean };
```

- `init`:webview 首次 ready 時送一次
- `snapshot`:資料層變更時(registry / groupStore)
- `collapseChanged`:section 收合狀態被命令面板改了,推廣播

### 5.2 Webview → Host

```typescript
type WebviewMessage =
  | { type: 'webviewReady' }
  | { type: 'focus'; terminalId: TerminalId }
  | { type: 'toggleGroup'; groupId: GroupId }
  | { type: 'toggleSection'; sectionId: SectionId }
  | { type: 'moveTerminal'; terminalId: TerminalId; targetGroupId: GroupId; position?: number }
  | { type: 'moveGroup'; groupId: GroupId; targetIndex: number }
  | { type: 'newTerminal' }
  | { type: 'newGroup' }
  | { type: 'renameGroup'; groupId: GroupId }
  | { type: 'setGroupColor'; groupId: GroupId }
  | { type: 'deleteGroup'; groupId: GroupId }
  | { type: 'deleteTerminal'; terminalId: TerminalId }
  | { type: 'renameTerminal'; terminalId: TerminalId }
  | { type: 'copyName'; terminalId: TerminalId };
```

### 5.3 資料形狀

```typescript
interface TreeSnapshot {
  groups: GroupSnapshot[];
}

interface GroupSnapshot {
  id: GroupId;
  name: string;
  color: GroupColor;
  collapsed: boolean;
  terminals: TerminalSnapshot[];
  unseenCount: number;
}

interface TerminalSnapshot {
  id: TerminalId;
  name: string;        // 已剝過 UNSEEN_PREFIX
  isUnseen: boolean;
}

type SectionId = 'terminals' | 'mdns';

interface SectionState {
  id: SectionId;
  title: string;
  collapsed: boolean;
}
```

### 5.4 未知訊息容忍

Host 端收到未知 `type` 不 throw,只 log (`[panel] unknown message: ...`)。webview 與 host 跨版本時不會崩潰。

---

## 6. 檔案結構 (File Structure)

| 檔案 | 狀態 | 職責 |
|---|---|---|
| `src/extension.ts` | 修改 | 組裝層:把 `createTreeView` 換成 `registerWebviewViewProvider`;新增 toggle 命令 |
| `src/panelStore.ts` | **新增** | Side panel 視窗級狀態,持久化到 `workspaceState` |
| `src/panelProtocol.ts` | **新增** | 純模組:message 介面、`buildTreeSnapshot` 純函式 |
| `src/panelView.ts` | **新增** | `PanelViewProvider` (vscode-bound,沿用 DI 注入依賴) |
| `media/panel.html` | **新增** | webview 入口 HTML,僅含 CSP `<meta>` 與 `<script src="panel.js">` / `<link rel="stylesheet" href="panel.css">` 兩個外部引用 |
| `media/panel.js` | **新增** | webview 端 render + event handler + HTML5 drag-and-drop |
| `media/panel.css` | **新增** | 樣式:section card、group row、terminal row、unseen badge |
| `src/treeProvider.ts` | 修改 | `TerminalTreeProvider` class 移除/標 deprecated,`buildTreeItemSpec` 純函式保留(供 view title icon 計算或下輪 spec 評估刪除) |
| `src/treeSpec.ts` | 修改 | 加 `buildTreeSnapshotSpec` 純函式(本檔累積多種 spec 函式) |
| `package.json` | 修改 | `views.superset.terminals` 改為 `type: "webview"`;`menus.view/title` 加 toggle button command;`engines.vscode` 維持 `^1.85.0`(WebviewView 為穩定 API) |

### 6.1 `package.json` 重點片段 (預期)

```json
"views": {
  "superset": [
    {
      "id": "superset.terminals",
      "name": "Terminals",
      "type": "webview",
      "contextualTitle": "Superset"
    }
  ]
},
"commands": [
  { "command": "superset.toggleTerminalsCollapsed", "title": "Superset: Toggle Terminals", "icon": "$(chevron-up)" }
],
"menus": {
  "view/title": [
    { "command": "superset.newTerminal", "when": "view == superset.terminals", "group": "navigation" },
    { "command": "superset.newGroup", "when": "view == superset.terminals", "group": "navigation" },
    { "command": "superset.toggleTerminalsCollapsed", "when": "view == superset.terminals", "group": "navigation" }
  ]
}
```

icon 動態切換(`$(chevron-up)` / `$(chevron-down)`)靠命令的 `icon` 在 `collapseChanged` 時由 `vscode.commands.executeCommand('workbench.action.title.triggerRefresh')` 觸發重畫;若動態切換過於複雜,接受永遠顯示 `$(chevron-up)` 為單一圖示(降級方案)。

---

## 7. 錯誤處理 (Error Handling)

| 失敗情境 | 處理 |
|---|---|
| webview 收到 host 訊息,JSON parse 失敗 | webview:catch + `console.error` + 顯示 fallback 「panel 資料載入失敗,請重新打開 view」 |
| host 收到 `moveTerminal` 但 `terminalId` 不在 registry | log `[panel] move ignored: unknown terminalId=...`,靜默忽略 |
| host 收到 `focus` 但 `vscode.Terminal` 已 dispose | log + 主動 `webview.postMessage({type: 'snapshot', snapshot: buildTreeSnapshot(...)})` 讓 panel 刷新 |
| `workspaceState.update` 寫入失敗(磁碟滿、quota) | try/catch,log;記憶體狀態仍正確,下次重啟失去該次 toggle;不 throw |
| `webview.html` 找不到(csp 設定錯) | provider try/catch,log;panel 顯示空白 |
| webview script 載入失敗 | webview 顯示「panel script 載入失敗」;不影響 host 端其他功能 |
| Drag-and-drop 拖到自身 | webview:source === target 判斷,no-op |
| Drag-and-drop 拖到 UNGROUPED 群組 | webview 允許;host `groupStore.moveGroup` 已有 `if (groupId === UNGROUPED_ID) return` 防呆 |

哲學:host/webview 邊界上的錯誤一律 log 不 throw,避免拖垮整個 Extension Host。

---

## 8. 測試策略 (Testing)

### 8.1 保留的測試 (regression)

- `test/terminalRegistry.test.ts` (14 cases)
- `test/groupStore.test.ts`
- `test/outputWatcher.test.ts` (5 cases)
- `test/ptyTerminalHost.test.ts` (14 cases)
- `test/highlightPresenter.test.ts` (9 cases)
- `test/autoReplace.test.ts`
- `test/smoke.test.ts`

### 8.2 新增的測試

| 測試檔 | 對象 | 預估 cases |
|---|---|---|
| `test/panelStore.test.ts` | `PanelStore` 純狀態 + `workspaceState` mock | ~6 |
| `test/buildTreeSnapshot.test.ts` | `buildTreeSnapshot(registry, groupStore)` 純函式 | ~8 |
| `test/panelProtocol.test.ts` | 訊息路由:給 `type` 判斷該呼叫哪個 store / command | ~10 |
| `test/renderTree.test.ts` | 純函式「給 snapshot 回 HTML 字串」(模擬 webview 端) | ~8 |

### 8.3 不測的部分

- `PanelViewProvider` class 本體 (vscode-bound) — 沿用既有 `TerminalTreeProvider` 不測的慣例
- 實際 webview DOM 行為 — 用 renderTree 純函式做對等測試
- `media/panel.js` 內部互動 — 透過 renderTree + message protocol 測試覆蓋

### 8.4 測試目標

- 既有 48 cases 全綠
- 新增 ~32 cases
- 本輪結束總計約 80 cases

---

## 9. 已知限制與下輪預留 (Known Limits & Future Hooks)

| 項目 | 限制 / 預留 |
|---|---|
| icon 動態切換 | 降級方案:固定 `$(chevron-up)`,不依賴 title refresh |
| 多 section 並排 | 本輪只實作 Terminals section;mDNS section 是下輪 spec 範圍,本輪只預留 `SectionId = 'terminals' \| 'mdns'` 型別與 `PanelStore` 的 `Map<SectionId, boolean>` 介面 |
| Drag-and-drop | 本輪保留 group 內 terminal 移動、group 重排;新增 group-to-group 拖拽(下輪 spec 評估) |
| 收合動畫 | 純 `display: none` 切換,無動畫;若需要 CSS transition 為下輪 spec 評估 |
| 多視窗同步 | `workspaceState` 是該視窗級,不同 VSCode 視窗可有不同摺疊狀態;符合預期 |

---

## 10. 變更摘要 (Change Summary)

- **新增 6 檔**: `panelStore.ts`、`panelProtocol.ts`、`panelView.ts`、`media/panel.html`、`media/panel.js`、`media/panel.css`
- **修改 4 檔**: `extension.ts`、`treeProvider.ts`、`treeSpec.ts`、`package.json`
- **新增 4 測試檔**: 見 §8.2
- **既有 48 個 tests 必須全綠**
- **新 view type**:`superset.terminals` 從 `view` (TreeView) 改為 `webview` (WebviewView)
- **新命令**:`superset.toggleTerminalsCollapsed`
- **新 persistence key**:`superset.panel.<SectionId>.collapsed`(workspace 視窗級)
