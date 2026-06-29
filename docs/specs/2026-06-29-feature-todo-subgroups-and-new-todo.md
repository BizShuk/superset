# TODO 區段分組與新增待辦事項按鈕規格 (TODO Subgroups and New TODO Button Spec)

本規格定義了 `superset.todo` 面板的區段分組展示與新增待辦事項功能的實作詳情。

## 實作內容

1. **區段分組 (Subgroup)**：
   - 讀取 `README.todo` 中以 `##` 或 `###` 開頭的標題做為區段節點 (`kind: "section"`)。
   - 未分類在任何標題底下的根節點項目，將歸類在名為 `Default` 的預設區段節點下。
   - 在樹狀檢視中，區段節點預設展開，且圖示設為 `tag`。

2. **新增待辦事項 (New TODO)**：
   - 全域新增按鈕：在 TODO 面板標題列提供 `+` 按鈕。點擊時提示輸入待辦內容與目標區段名稱（預設為 `modify`）。
   - 行內新增按鈕：在每個區段節點旁提供行內 `+` 按鈕。點擊時直接提示輸入待辦內容，自動插入該選定區段。
   - Priority 篩選按鈕：在選中時使用亮色 SVG 圖示（`p0.svg`/`p1.svg`/`p2.svg`），在未選中時使用對應的 dim/dark SVG 圖示（`p0_dim.svg`/`p1_dim.svg`/`p2_dim.svg`）。

## 變更檔案

### 待辦事項模組 (Todo Module)

#### [types.ts](file:///Users/bytedance/projects/superset/src/todo/types.ts)
- `TodoItem` 介面的 `kind` 型別支援 `"section"`。

#### [todoStore.ts](file:///Users/bytedance/projects/superset/src/todo/todoStore.ts)
- 更新 `load()` 支援解析 Markdown 標題為區段節點。
- 實作 `addTodo(text, sectionName)` 用於將待辦事項寫入 Markdown 對應區段末尾。

#### [todoTreeProvider.ts](file:///Users/bytedance/projects/superset/src/todo/todoTreeProvider.ts)
- 支援渲染 `kind === "section"` 的節點。
- 更新 `applyPriorityFilter` 邏輯，保留含有匹配子項目的區段節點。

#### [index.ts](file:///Users/bytedance/projects/superset/src/todo/index.ts)
- 註冊並訂閱 `superset.todoNew` 指令。

#### [package.json](file:///Users/bytedance/projects/superset/package.json)
- 註冊 `superset.todoNew` 命令。
- 設定選中與未選中的 priority 篩選按鈕圖示。

## 驗證結果

### 自動化測試
- 執行 `npm test`，所有 199 個測試案例（包含針對 section 解析、`addTodo`、區段篩選的新單元測試）皆順利通過。
