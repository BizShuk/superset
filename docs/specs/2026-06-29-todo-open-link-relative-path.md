# TODO 項目開啟連結相容工作區相對路徑規格 (Todo Open Link Relative Path Spec)

本規格記錄了如何擴充 TODO 面板點擊連結功能，使其能支援當前工作區 (workspace) 相對路徑與 `file://` / `file:///` 協定。

## 背景與需求

之前 TODO 清單點擊連結的實作 (`superset.todoOpenLink` 指令) 僅支援一般的 HTTP/HTTPS 連結與以絕對路徑表示的本地檔案。
當連結使用以下格式時，舊有邏輯無法解析而報錯：
1. 以 `file:///` 開頭的絕對路徑本地檔案 URI。
2. 以 `file://` 開頭的相對路徑（例如 `file://plans/xxx.md`）。
3. 一般的相對路徑（例如 `plans/xxx.md` 或 `./plans/xxx.md`）。

本規格定義了解析與解析後的開啟邏輯，以達到與工作區無縫相容。

## 技術設計與規格

在 `src/todo/todoTreeProvider.ts` 內設計了一個具備完整單元測試的解析純函式 `resolveTodoLink`。

### 1. `resolveTodoLink(target, workspaceFolder)` 介面
- 輸入：`target`（提取出的連結字串）、`workspaceFolder`（當前工作區根目錄路徑）。
- 輸出：`ResolvedLink` 物件，結構如下：
  ```typescript
  export interface ResolvedLink {
      readonly type: "url" | "file";
      readonly uriOrPath: string;
  }
  ```

- **解析邏輯**：
  - 如果 `target` 以 `http://`、`https://` 或 `file:///` 開頭，代表它是可以直接由 VS Code 解析的標準 URI，回傳 `{ type: "url", uriOrPath: target }`。
  - 如果 `target` 以 `file://` 開頭，先將前綴移除得到 `cleanPath`。
  - 如果是一般路徑或移除前綴後的 `cleanPath`：
    - 若 `cleanPath` 為絕對路徑，回傳 `{ type: "file", uriOrPath: cleanPath }`。
    - 若 `cleanPath` 為相對路徑，則與 `workspaceFolder` 拼接後回傳 `{ type: "file", uriOrPath: resolvedPath }`。

### 2. 開啟連結指令 `superset.todoOpenLink`
取得 `resolveTodoLink` 的回傳值後：
- 若 `type` 為 `url`：使用 `vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(uriOrPath))` 開啟。
- 若 `type` 為 `file`：使用 `vscode.commands.executeCommand("vscode.open", vscode.Uri.file(uriOrPath))` 開啟。

## 測試覆蓋範圍

在 `test/todoTreeProvider.test.ts` 中新增了測試，覆蓋了以下 5 種場景：
- HTTP/HTTPS 連結。
- `file:///` 格式的絕對檔案 URI。
- `file://` 格式的相對路徑連結。
- 一般相對路徑（包括有/無 `./`）。
- 一般絕對路徑。
