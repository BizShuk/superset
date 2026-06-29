# TODO 項目複製指令規格 (Todo Copy Command Spec)

本規格記錄了在 TODO 面板項目的 Context Menu（編輯選單）中，新增「複製 (Copy)」指令的實作設計與設定。

## 背景與需求

為了提升使用體驗，在 TODO 項目上點選右鍵（Context Menu）時，需要能夠一鍵複製該 TODO 項目的文字至系統剪貼簿。該功能需支援所有的 TODO 項目，包含：
- Checkbox 項目
- 一般清單項目
- 區段項目 (Section)

## 技術設計與規格

### 1. 指令定義與選單配置 (package.json)
- 在 `contributes.commands` 中註冊 `superset.todoCopy`：
  ```json
  {
      "command": "superset.todoCopy",
      "title": "Copy",
      "icon": "$(copy)"
  }
  ```
- 在 `contributes.menus["view/item/context"]` 中配置選單項，使其在所有的 TODO 項目型態顯示，並分配在代表複製動作的 `5_copy` 群組中：
  ```json
  {
      "command": "superset.todoCopy",
      "when": "viewItem == todoCheckbox || viewItem == todoCheckboxWithLink || viewItem == todoList || viewItem == todoListWithLink || viewItem == todoSection",
      "group": "5_copy"
  }
  ```

### 2. 指令實作 (src/todo/index.ts)
- 註冊並實作 `superset.todoCopy`：
  - 此指令接收 `TodoItem` 作為參數。
  - 使用 `vscode.env.clipboard.writeText(item.text)` 將項目文字複製到系統剪貼簿中。
  - 將傳回的 `copyTodoCmd` 加入 extension 訂閱集合 (`ctx.subscriptions`)，並在 extension 釋放時調用 `copyTodoCmd.dispose()` 清理資源。

## 驗證範圍

- **型別與編譯**：執行 `npm run build` 確認全部程式碼可以成功透過 `tsc` 型別檢查並打包成功。
- **測試回歸**：執行 `npm test` 確認既有的 209 個單元測試均不受影響。
