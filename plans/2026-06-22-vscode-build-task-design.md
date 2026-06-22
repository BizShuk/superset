# VS Code 建置任務設計規格 (VS Code Build Task Design Specification)

此文件記錄專案中 VS Code 建置任務與 `package.json` 指令的調整設計。

## 背景與目標 (Background and Goal)

為簡化 VS Code 擴充功能的開發流程，我們需要一個一鍵執行的建置任務，該任務需自動執行相依套件安裝、編譯型別檢查以及打包。

## 設計方案 (Design Details)

我們採取將所有建置步驟封裝在 `package.json` 的 `build` 腳本中，並透過 VS Code 的 `npm` 類型任務來呼叫它。

### 1. 修改 `package.json`

在 `scripts` 中將 `build` 腳本調整為組合指令：

```json
"scripts": {
    "build": "npm install && tsc && npx @vscode/vsce package",
    ...
}
```

### 2. 建立 `.vscode/tasks.json`

在專案根目錄下建立 `.vscode/tasks.json`：

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "type": "npm",
            "script": "build",
            "group": {
                "kind": "build",
                "isDefault": true
            },
            "problemMatcher": ["$tsc"],
            "presentation": {
                "reveal": "always",
                "panel": "shared",
                "clear": true
            },
            "label": "npm: build"
        }
    ]
}
```

## 驗證計畫 (Verification Plan)

1. 在 VS Code 中使用 `Cmd+Shift+B` 執行建置任務。
2. 確認終端機依序執行：
   - `npm install`
   - `tsc` (編譯並檢查語法)
   - `npx @vscode/vsce package` (打包出 `.vsix` 檔案)
3. 驗證編譯若有錯誤時，`問題 (Problems)` 面板中能正確標示錯誤位置。
