# 實作 TODO 項目行內超連結 (Implement TODO Inline Links) - 已實作規格

本文件記錄已實作的 TODO 項目行內超連結功能之設計與變更。

## 1. 實作架構 (Architecture)
- **連結檢測與清理**：在 `TodoTreeProvider` 中，新增 `extractLink` 用以尋找 Markdown 連結目標或一般 HTTP/HTTPS 網址，並使用 `cleanLabelText` 移除 TreeView label 中的 markdown 標記（如 `[text](url)` 轉換為 `text`）。
- **選單配置與命令**：在 `package.json` 中註冊 `superset.todoOpenLink` 命令與其 inline 顯示條件（當 `viewItem == todoCheckboxWithLink` 或 `viewItem == todoListWithLink` 時懸停顯示）。
- **命令執行**：當點選右側行內圖示時，觸發命令，若是網址則使用預設瀏覽器開啟，若是本機檔案則解析為相對於工作區根目錄的絕對路徑，並使用編輯器開啟。

---

## 2. 檔案異動表 (File Structure)

| 動作 | 檔案 | 職責 |
| --- | --- | --- |
| 修改 | [todoTreeProvider.ts](file:///Users/bytedance/projects/superset/src/todo/todoTreeProvider.ts) | 實作 `extractLink` 與 `cleanLabelText` 輔助函式，並在 `getTreeItem` 和 `buildListItem` 啟用它們，視情況調整 `contextValue` 為 `todoCheckboxWithLink` 或 `todoListWithLink`。 |
| 修改 | [package.json](file:///Users/bytedance/projects/superset/package.json) | 註冊 `superset.todoOpenLink` 命令，並在 `view/item/context` 加入該命令以在 inline 顯示。 |
| 修改 | [index.ts](file:///Users/bytedance/projects/superset/src/todo/index.ts) | 註冊 `superset.todoOpenLink` 命令的處理常式，解析連結並呼叫 `vscode.open` 開啟。 |
| 修改 | [todoTreeProvider.test.ts](file:///Users/bytedance/projects/superset/test/todoTreeProvider.test.ts) | 針對 `extractLink`、`cleanLabelText` 以及 TreeItem 進行單元測試驗證。 |

---

## 3. 測試與驗證 (Verification)
- **單元測試**：在 `test/todoTreeProvider.test.ts` 中實作對 `extractLink`、`cleanLabelText` 的功能測試，並測試項目帶有連結時的標籤清洗與 `contextValue` 綁定。
- **建置包裝與安裝**：已成功編譯與打包為 `superset-0.3.1.vsix` 並安裝至 IDE 中。
