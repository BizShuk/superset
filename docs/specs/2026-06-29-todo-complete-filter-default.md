# 啟用已完成任務過濾器並預設隱藏已完成任務 (Enable Complete Filter and Default to Hiding Completed Tasks)

此文件紀錄已實作之 TODO 清單「已完成任務過濾器」功能。當使用者啟用過濾時，使用實心圖示 `$(filter-filled)` 並隱藏已完成任務；未啟用時使用空心圖示 `$(filter)` 並顯示已完成任務。同時，預設行為調整為隱藏已完成任務。

## 修改細節 (Implemented Changes)

### TODO 模組 (TODO Module)

#### [package.json](file:///Users/bytedance/projects/superset/package.json)
- 對調 `superset.todoFilterHideCompleted` (隱藏已完成) 與 `superset.todoFilterShowAll` (顯示所有) 的圖示 (Icons)：
  - `superset.todoFilterHideCompleted` 的 `icon` 改為 `$(filter)`。
  - `superset.todoFilterShowAll` 的 `icon` 改為 `$(filter-filled)`。
- 遞增版本號至 `0.3.4`。

#### [todoTreeProvider.ts](file:///Users/bytedance/projects/superset/src/todo/todoTreeProvider.ts)
- 將 `showCompleted` 的預設值改為 `false`，以便預設隱藏已完成的任務。

#### [todoTreeProvider.test.ts](file:///Users/bytedance/projects/superset/test/todoTreeProvider.test.ts)
- 更新 `toggles showCompleted and returns the new value` 測試的期待值。
- 修改其他測試以在 provider 建立後呼叫 `provider.toggleShowCompleted()`，將其狀態重設回顯示完成項目，以便順利測試項目的排序與顯示邏輯。

## 驗證結果 (Verification Results)
- 單元測試 `npm test` 209 個案例全部通過。
- 成功建置包 `superset-0.3.4.vsix` 並成功安裝至 IDE 中。
