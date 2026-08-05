# 移除 Overall 面板與跨專案 TODO (2026-08-05)

## 背景 (Context)

`Overall`（manifest id `superset-overall`）是 Activity Bar 的第二顆 icon，底下兩個 sibling views：

- `superset.workspaceTodo`（Workspace TODO）：遞迴掃描 current workspace root。
- `superset.projectsTodo`（Projects TODO）：固定掃描 `~/projects` depth 1–5。

`SuperSet → TODO`（`superset.todo`）掛的是`同一個` tree provider，掃描邊界與 Workspace TODO 完全相同，
只多了 view-type 切換（Section / Priority / File）。也就是說 Overall 的兩個 view 一個是 TODO 的重複品，
另一個是跨 repository 一覽。

## 決策 (Decision)

整組移除 `Overall`：View Container、兩個 view、`superset.projectsTodo*` 命令與 menu、
`superset.focusOverallView`，以及 `~/projects` 的跨專案掃描路徑。TODO domain 收斂成`單一`面板。

### 移除項目

| 類別 | 內容 |
| --- | --- |
| View Container | `superset-overall`（Activity Bar item + `views` 條目） |
| Tree View | `superset.workspaceTodo`、`superset.projectsTodo` |
| 命令 | 26 個 `superset.projectsTodo*` 與 `superset.focusOverallView` |
| Menu / Keybinding | 所有 `view == superset.projectsTodo`、`viewItem == projectsTodo*` 條目與 `projectsTodoRename` 的 `F2` |
| 程式碼 | `src/projectsTodo/`（plugin、register、`~/projects` scan）整個目錄 |
| 資料流 | `ProjectsTodoStore.load()`／`getStores()`／`getStore()`（`~/projects` 掃描與其 store map）、`~/projects` 的 `README.todo` 與 `plans/*.md` file watcher |
| Panel layout | `TRACKED_VIEW_IDS` 的兩個 view id |
| 診斷 | `DiagnosticsSnapshot.projectsTodoProjectCount` 與其表格列 |

### 保留並搬移

共用的 store / provider 是 `superset.todo` 的實作，隨 TODO domain 一起搬進 `src/todo/`：

| 移除前 | 移除後 |
| --- | --- |
| `src/projectsTodo/projectsTodoStore.ts` → `ProjectsTodoStore` | `src/todo/workspaceTodoStore.ts` → `WorkspaceTodoStore` |
| `src/projectsTodo/projectsTodoTreeProvider.ts` → `ProjectsTodoTreeProvider` | `src/todo/workspaceTodoTreeProvider.ts` → `WorkspaceTodoTreeProvider` |
| `src/projectsTodo/types.ts` → `ProjectTodoItem` 等 | `src/todo/types.ts` → `WorkspaceTodoItem`、`WorkspaceTodoChange`、`WorkspaceTodoListener` |
| `src/projectsTodo/storeDispatch.ts` | `src/todo/storeDispatch.ts` |
| `src/projectsTodo/index.ts#superset.openProject` | `src/todo/index.ts#superset.openProject` |

Provider 的 `rootMode: "projects" | "workspace"` 參數一併移除 —— 只剩 workspace 一種 root rendering。

## Context value 收斂 (Context Values)

移除前 `superset.todo` 的列渲染吐的是 `projectsTodo*` context values，靠 `superset.projectsTodo*` 命令服務
right-click / inline 動作。移除 Projects TODO 後這條相依會斷，因此 provider 的 prefix 一律改成 `todo`：

- `projectsTodoCheckbox*` / `projectsTodoList*` / `projectsTodoSection*` → 對應的 `todo*`
- `projectsTodoProject` → `todoProject`、`projectsTodoPlan` → `todoPlan`
- `projectsTodoPlansSection` → `todoPlansSection`、`projectsTodoWorkspaceSection` → `todoWorkspaceSection`

`todo*` 的 menu 條目原本就存在，只補上 project row 的三個缺口：`superset.todoCopy`、`superset.todoNew`、
`superset.todoOpen` 加上 `viewItem == todoProject`，並把 `superset.openProject` 的 inline icon 重新綁到
`todoPlan` / `todoProject`。

## 行為變更 (Behavior Changes)

1. **設定 key 更名**：`superset.projectsTodo.maxDepth` → `superset.todo.maxDepth`（型別、範圍 1–10、
   預設 5 不變）。舊 key 不再被讀取；曾自訂深度的使用者要重新設定一次。
2. **Archive section 判定修正**：`computeSectionContextValue` 原本查 `~/projects` 的 store map，
   在 workspace 面板一律 miss，導致 archive 過的 section 仍顯示 `Archive` 而不是 `Unarchive`。
   改查 `getWorkspaceStore` 後，`todoSectionArchived` 會如實出現。
3. **Receiver-safe dispatch**：`src/todo/` 原本把 store method 取出來當裸函式呼叫（`this` 遺失）；
   改走 `invokeTodoStoreMutation`，與移除前 Projects TODO 面板的行為一致。
4. `~/projects` 底下的 `README.todo` 與 `plans/*.md` 不再有 file watcher —— Extension 不再讀 workspace 之外的檔案。

## 驗證 (Verification)

- `npm test`：95 個檔案、1046 個 case 全綠（含新增的「Overall 已移除」manifest 契約測試）。
- `npm run build`：clean → `npm ci` → TypeScript compile → VSIX 打包 → `scripts/verify-vsix.sh`。
