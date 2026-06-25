# 將 `extension.ts` 拆分為以功能為單位的小模組 (Extension Module Split)

> 把目前 `src/extension.ts`(1033 行,單檔 god-object)內的五個子功能區塊(terminals / explorer / mDNS / topology / todo)各自抽成獨立模組,`extension.ts` 退化為 composition root。

## 為何要做 (Why)

- **Cognitive load**:`extension.ts` 單檔 1033 行,五個子功能各有自己的 `createTreeView` + provider 啟停 + 檔案 watcher + 命令註冊。新增 / 改任何一個子功能都要在同一個 closure scope 內捲動瀏覽所有上下文,容易誤觸其他區塊的變數。
- **可測性**:目前子功能的 wiring 邏輯(tree view 與 provider 配對、watcher 串接)藏在 `activate()` 內,**沒有任何單元測試** — 因為它依賴 `vscode` 全域;但若抽成純函式,邏輯就可注入 mock 測試。
- **結構對稱**:每個子功能現在的 shape 完全一樣(都是「Store + Provider + View + Watcher + Commands」五件套),但程式碼沒有抽出共通的 pattern,所以每次新增子功能都會重抄一遍。
- **既有 plan 鋪墊**:本倉 `plans/` 已有多份「子功能增強」文件(如 `2026-06-22-superset-terminals-panel-collapse.md`、`2026-06-23-todo-nested-items.md`),但都沒觸及模組結構;這個 plan 補上根因。

## 使用者審查要求 (User Review Required)

> [!IMPORTANT]
> - 本次變更**不會改變使用者可見行為**(view container、五個子面板、按鈕、命令、context key、keybinding、status bar badge 全部保留)。所有變更都是內部重構。
> - 拆分後的模組之間透過「composition root 注入」耦合,而不是直接互相 import — 維持單向依賴,避免循環。
> - `activate()` 與 `deactivate()` 仍是 VSCode 的 entry point(不能換地方)。
> - 若使用者不偏好這次重構,改採「只把每個子功能抽成一個 helper function,留在 `extension.ts` 內」這個更小幅度的方案也是可接受的折衷。

## 提議的變更 (Proposed Changes)

### 模組結構 (Module Structure)

```
src/
├── extension.ts                  (composition root,~80 行)
├── features/
│   ├── terminals/
│   │   ├── index.ts              (registerFeature 的 entry)
│   │   ├── registry.ts           (TerminalRegistry 工廠 + watcher setup)
│   │   └── commands.ts           (focus / delete / copyName / rename)
│   ├── explorer/
│   │   ├── index.ts
│   │   ├── store.ts
│   │   └── commands.ts
│   ├── mdns/
│   │   ├── index.ts
│   │   ├── registry.ts
│   │   └── commands.ts
│   ├── topology/
│   │   ├── index.ts
│   │   ├── store.ts
│   │   └── commands.ts
│   └── todo/
│       ├── index.ts
│       ├── store.ts
│       ├── badge.ts              (refreshTodoFilterBadge 邏輯抽出)
│       └── commands.ts
```

每個 `features/<name>/index.ts` 統一 export:

```typescript
export interface FeatureContext {
    context: vscode.ExtensionContext;
    subscriptions: vscode.Disposable[];
    workspaceFolder: string;
    /** Cross-feature shared state, e.g. shared status bar. */
    shared: SharedDeps;
}

export function register(ctx: FeatureContext): FeatureHandle;
```

`FeatureHandle` 內含 `dispose: () => void`,讓 root 在 `deactivate` 統一拆掉。

---

#### [MODIFY] [extension.ts](file:///Users/bytedance/projects/superset/src/extension.ts)

- 刪除 5 個子功能的 inline setup,改為:
  ```typescript
  const ctx: FeatureContext = { context, subscriptions, workspaceFolder, shared };
  registerTerminals(ctx);
  registerExplorer(ctx);
  registerMdns(ctx);
  registerTopology(ctx);
  registerTodo(ctx);
  ```
- 保留 `activate()` / `deactivate()` 入口、`Superset` diagnostic OutputChannel、Superset status bar 共享物件。

#### [NEW] [src/features/terminals/index.ts](file:///Users/bytedance/projects/superset/src/features/terminals/index.ts)

- 把現有 `extension.ts` 內的 `TerminalRegistry` + `OutputWatcher` + `PtyTerminalHost` + `TerminalTreeProvider` + `HighlightPresenter` + `ptySpawner` 全部搬過來。
- 把 closure(`watchedTerminal`、`lastActiveTime`、`ptyBackedTerminals`)封裝成 module-private state,不再外洩。
- 透過 `FeatureHandle.dispose()` 處理 `deactivate`。

#### [NEW] [src/features/todo/badge.ts](file:///Users/bytedance/projects/superset/src/features/todo/badge.ts)

- 把 `refreshTodoFilterBadge` 與 `updateTodoFilterBadge` 抽出為可注入函式。
- 寫成純函式,接 `getTopLevelCount`、`getVisibleTopLevelCount`、`isFiltering`、`titlePrefix`,回傳下一個 title 字串 — 即可單元測試。

---

### 跨模組的共用型別 (Shared Types)

#### [MODIFY] [types.ts](file:///Users/bytedance/projects/superset/src/types.ts)

- 新增 `FeatureContext` 與 `FeatureHandle` 介面。
- 不變更既有 `TerminalHandle` / `TodoItem` 等。

---

### 測試 (Tests)

#### [NEW] [src/features/todo/badge.test.ts](file:///Users/bytedance/projects/superset/src/features/todo/badge.test.ts)

- 純函式測試:給定 `isFiltering: false`,回傳純 title 沒有 `(已隱藏 N 個)`;給定 `isFiltering: true, hidden: 3`,回傳帶後綴的 title。
- 不需要 mock `vscode`,因為 badge 是純函式。

#### [NEW] [src/features/extensionRoot.test.ts](file:///Users/bytedance/projects/superset/src/features/extensionRoot.test.ts)

- 驗證 `activate()` 呼叫所有 5 個 `register*` 函式,且每個都被呼叫一次;提供 fake `FeatureContext.subscriptions`,確認 disposal 流程。
- 仍需要 mock `vscode`,但僅限於 extension API;核心 wiring 邏輯變得可驗證。

## 驗證計劃 (Verification Plan)

### 自動化測試

- 執行 `npm test`,所有既有 156 個 case 必須全綠(行為不變)。
- 新增 2 個 test file,共 6+ 個新 case。

### 手動驗證

- 啟動 Extension Development Host(按 F5),確認:
  - 五個子面板(Terminals / Explore / MDNS / Topology / TODO)都在,且內容與重構前一致。
  - 點擊 Terminal 的「新增」、「重新整理」、MDNS 的「重新整理」、Topology 的「Scan」、TODO 的「Hide Completed / Show All」按鈕都運作。
  - status bar 通知仍可點擊跳到 Terminals 面板。
  - `deactivate()` 後所有 disposable 都正確釋放(透過 `console.log` 在 OutputChannel 觀察)。

### 重構前後檔案大小對比 (預期)

| 檔案                     | 重構前行數 | 重構後預期 |
| ------------------------ | ---------- | ---------- |
| `src/extension.ts`       | 1033       | ~80        |
| `src/features/terminals` | 0          | ~400       |
| `src/features/explorer`  | 0          | ~150       |
| `src/features/mdns`      | 0          | ~250       |
| `src/features/topology`  | 0          | ~150       |
| `src/features/todo`      | 0          | ~250       |

> 估算包含「程式碼 + 必要 JSDoc」;實際可能因 import / 介面宣告而略有出入。

## 風險與緩解 (Risks & Mitigations)

| 風險                                     | 緩解                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------- |
| 重構破壞現有測試                         | 拆 commit 為多個小 PR,每個 PR 跑完整 `npm test` 才進下一步          |
| 跨模組狀態(例如 `watchedTerminal`)被誤刪 | 重構前先寫 1-2 個 integration test 釘住關鍵流程,重構後行為需一致    |
| `vscode` API 的 import 仍可能污染測試   | `feature/extensionRoot.test.ts` 用 `vi.mock("vscode", ...)` 與既有 `todoTreeProvider.test.ts` 同樣手法處理 |

## 預估工作量 (Effort Estimate)

- 拆檔 + 重新 import:約 2 小時
- `badge.ts` 純函式化 + 測試:30 分鐘
- 整合測試 + 手動驗證:1 小時
- 總計:約 3.5 小時

## 後續 (Follow-ups, 非本次範圍)

- 把 `AutoReplace` 與 `setWatchedTerminal` 邏輯進一步抽成獨立的「PTY lifecycle」utility,跨 features 共用。
- 評估是否把 `vscode.EventEmitter` 包裝成輕量 RxJS-like stream,讓子功能之間能宣告式組合事件。
