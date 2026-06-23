# 支援縮進複選框的嵌套待辦事項面板 (Nested TODO Panel via Indented Checkboxes)

支援在 `README.todo` 中讀取縮進的複選框項目，並在側邊欄的 TODO 面板中將其呈現為嵌套的待辦事項。

## 使用者審查要求 (User Review Required)

> [!IMPORTANT]
> - 本次變更將調整 `TodoItem` 的型別定義，新增選用屬性 `children?: TodoItem[]`。
> - 我們將在樹狀檢視中使用 `vscode.TreeItemCollapsibleState.Expanded`，預設展開所有子待辦事項，以方便使用者檢視完整的項目結構。
> - 待辦事項的排序邏輯（未完成的優先顯示，已完成的在後方）將同時套用至根項目與所有子項目中。

## 提議的變更 (Proposed Changes)

### 待辦事項模組 (Todo Module)

---

#### [MODIFY] [types.ts](file:///Users/bytedance/projects/superset/src/types.ts)
- 在 `TodoItem` 介面中新增 `children?: TodoItem[];` 屬性。

#### [MODIFY] [todoStore.ts](file:///Users/bytedance/projects/superset/src/todoStore.ts)
- 更新 `load()` 方法：
  - 修改正則表達式，允許比對行首的縮進空白字元（包含空格與 Tab 定位字元）。
  - 使用堆疊 (Stack) 資料結構，依縮進層級建構樹狀結構。
- 更新 `toggle()` 方法：
  - 修改正則表達式以正確比對並保留被點擊之縮進待辦事項的前置空白與符號。

#### [MODIFY] [todoTreeProvider.ts](file:///Users/bytedance/projects/superset/src/todoTreeProvider.ts)
- 更新 `getTreeItem()`：
  - 根據該節點是否含有 `children` 來決定將 `collapsibleState` 設定為 `Expanded` 或 `None`。
- 更新 `getChildren(element?: TodoItem)`：
  - 支援傳入 `element` 參數。若有傳入，則返回該 `element` 的 `children`（排序為未完成在前、已完成在後）。
  - 若無傳入（根節點），則返回 `store.getItems()`（同樣進行排序）。

---

### 測試程式 (Tests)

#### [NEW] [todoStore.test.ts](file:///Users/bytedance/projects/superset/test/todoStore.test.ts)
- 新增對 `TodoStore` 讀取巢狀結構與切換狀態 (Toggle) 的單元測試，確保邏輯完全正確。

## 驗證計劃 (Verification Plan)

### 自動化測試
- 執行 `npm test`，確保所有既有與新增的單元測試皆順利通過。

### 手動驗證
- 在 VS Code 測試環境中編輯 `README.todo` 並加入多層縮進的待辦事項，驗證側邊欄是否能即時且正確地呈現嵌套結構，且點擊狀態切換功能運作正常。
