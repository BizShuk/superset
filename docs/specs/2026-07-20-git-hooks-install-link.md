# Git Hooks Install、Link 與狀態提醒設計

日期：2026-07-20

## 目標

Superset 提供兩個公開 VS Code commands，協助目前 VS Code 視窗所開啟的第一個 folder 安裝與連結 Git hooks：

- `Superset: Install Git Hooks`：從 extension 內建模板補齊 `.githooks/`，再自動連結。
- `Superset: Link Git Hooks`：只設定 repository-local `core.hooksPath`。

當第一個 opened folder 已有 `.githooks/`，但 local `core.hooksPath` 沒有非空值時，左側 Status Bar 顯示可點擊的未連結提醒。

## 範圍與名詞

本文的 opened folder 固定指 `vscode.workspace.workspaceFolders?.[0]`：

- 涵蓋 `File → Open Folder...` 開啟的 folder。
- 涵蓋 `.code-workspace` 的第一個 folder。
- Multi-root 視窗只處理第一個 folder。
- 不使用 `.code-workspace` 檔案所在目錄、active editor 目錄、process current working directory 或其他 folder。
- 沒有 opened folder 時不使用 fallback。

功能僅支援本機 `file:` folder 與其中的 Git repository。

## 資源結構

整個根目錄 `resources/` 搬至 `pkg/resources/`。Git hook 模板增加一層 Git domain 分類，與 `src/git/` 對齊：

```text
pkg/
└── resources/
    ├── git/
    │   └── githooks/
    │       └── scripts/
    │           └── sync-plugin-version.sh
    ├── config/
    ├── icon.png
    └── *.svg

src/
└── git/
    ├── gitHooks.ts
    ├── index.ts
    ├── githubUrl.ts
    └── gitReset.ts
```

模板來源固定為 `pkg/resources/git/githooks/`；安裝目標固定為 opened folder 根目錄的 `.githooks/`。`resources/git/` 分類不會被複製成 workspace 路徑的一部分。

資源搬移必須同步更新 `package.json`、source、tests、`.vscodeignore`、VSIX 驗證與仍有效的文件引用。VSIX 必須包含：

```text
pkg/resources/git/githooks/**
pkg/resources/config/**
pkg/resources/*.svg
pkg/resources/icon.png
```

## 元件設計

### `src/git/gitHooks.ts`

此模組承擔可獨立測試的 filesystem 與 Git config 邏輯：

- 遞迴列出內建 Git hook 模板。
- 建立目標 `.githooks/` 及其子目錄。
- 只複製目標不存在的模板檔案。
- 保留所有同名既有檔案，不比較或覆寫內容。
- 保留模板檔案權限，包含 shell script executable bit。
- 讀取 repository-local `core.hooksPath`。
- 寫入 `git config --local core.hooksPath .githooks`。

此模組不建立 VS Code UI。

### `src/git/index.ts`

既有 `gitPlugin` 繼續作為 Git feature orchestration layer，新增：

- `superset.installGitHooks` command。
- `superset.linkGitHooks` command。
- 左側 `StatusBarItem`。
- activation 時的初次狀態檢查。
- command 完成後的狀態刷新與使用者通知。

不新增獨立 `gitHooksPlugin`，避免拆散同一 Git domain。Status Bar 由 `gitPlugin` 建立並加入既有 disposable pool，不共用 Terminals 的 Status Bar。

## Command 行為

### `Superset: Install Git Hooks`

此 command 只由使用者從 Command Palette 手動執行，Status Bar 不會觸發 Install。

流程：

1. 解析 `workspaceFolders[0]`。
2. 確認 folder 使用 `file:` URI 且為 Git repository。
3. 從 `pkg/resources/git/githooks/` 遞迴補齊 `.githooks/`。
4. 已存在的同名檔案全部跳過，不顯示 overwrite prompt。
5. 若全部複製操作成功，執行與 Link command 相同的連結邏輯。
6. 重新檢查 Status Bar。
7. 顯示新增檔案數、跳過檔案數與連結結果。

若任一檔案複製失敗，停止 Install，不執行 Link。已成功建立的檔案不自動刪除。

### `Superset: Link Git Hooks`

此 command 可由 Command Palette 或 Status Bar 點擊觸發。

流程：

1. 解析 `workspaceFolders[0]`。
2. 確認 folder 使用 `file:` URI 且為 Git repository。
3. 執行 `git config --local core.hooksPath .githooks`。
4. 重新檢查 Status Bar。
5. 顯示成功或錯誤訊息。

Link 不建立 `.githooks/`、不複製模板、也不驗證目錄中是否有 hook 檔案。

## Status Bar 規則

Extension activation 時只檢查第一個 opened folder。狀態矩陣如下：

| `.githooks/` | local `core.hooksPath` | Status Bar |
| --- | --- | --- |
| 不存在 | 任意 | 隱藏 |
| 存在 | trim 後有任意非空值 | 隱藏 |
| 存在 | 未設定或空值 | 顯示 |

顯示時：

- 位置在左側 Status Bar。
- 文字為 `$(link) Git hooks not linked`。
- Tooltip 說明 opened folder 已有 `.githooks/`，但 local `core.hooksPath` 未設定。
- Command 固定為 `superset.linkGitHooks`。

「已連結」只代表 local `core.hooksPath` 有非空值，不驗證該值是否為 `.githooks`、相對路徑或有效路徑。

本功能不監聽 `.githooks/` 或 `.git/config` 變更，也不輪詢；只在 activation、Install 完成與 Link 完成後重新檢查。

## 錯誤處理與安全性

- 沒有 opened folder：Status Bar 隱藏；手動 command 顯示無 opened folder。
- 第一個 folder 不是 `file:` URI：停止操作並顯示不支援的錯誤。
- 第一個 folder 不是 Git repository：Status Bar 隱藏；command 停止並顯示錯誤。
- 模板來源不存在或無法讀取：Install 失敗且不執行 Link。
- 部分複製失敗：保留已新增檔案，停止後續操作，不做可能誤刪使用者內容的 rollback。
- Git config 讀取失敗：Status Bar 不宣告成功狀態，記錄 diagnostic log；手動 command 顯示錯誤。
- Git config 寫入失敗：保留未連結提醒，讓使用者修正 repository 後重試。
- Link 僅修改 local config，不修改 global 或 system config。

## Manifest、版本與文件

`package.json` 新增兩個公開 commands：

- `superset.installGitHooks`，標題 `Superset: Install Git Hooks`。
- `superset.linkGitHooks`，標題 `Superset: Link Git Hooks`。

資源引用由 `resources/...` 全部改為 `pkg/resources/...`。實作此功能時依專案契約對 `package.json` 與 `package-lock.json` 做 semantic version patch bump，並更新 `README.md` command 使用說明與 `CLAUDE.md` Git module 結構。

## 測試策略

### 純邏輯測試

`gitHooks.ts` 測試涵蓋：

- 空目標完整補齊模板。
- 既有同名檔案內容不變。
- 缺少的巢狀目錄與檔案會被補齊。
- Shell script 保留 executable 權限。
- 未設定或空白 `core.hooksPath` 判為未連結。
- `.githooks` 與任意其他非空值都判為已連結。
- Link 固定使用 local scope 並寫入 `.githooks`。
- 複製失敗後不呼叫 Link。

### VS Code-bound 測試

Git plugin orchestration 與 mocks 測試涵蓋：

- 兩個 command 均有註冊。
- 只使用 `workspaceFolders[0]`。
- activation 執行一次狀態檢查。
- Status Bar 顯示與隱藏符合狀態矩陣。
- Status Bar 點擊只執行 Link，不執行 Install。
- Install 成功後自動 Link。
- Install 與 Link 完成後刷新狀態。
- 無 folder、非 file URI、非 Git repository 與 command failure 的通知行為。

### 完整驗證

因為變更 manifest、activation 行為與 VSIX 資源，實作完成後必須執行：

```text
npm test
npm run build
```

`npm run build` 必須驗證 VSIX 包含 `pkg/resources/` 所需檔案，且 production source 與 manifest 不再引用根目錄 `resources/`。

## 非目標

- 不支援第二個以上的 workspace folder。
- 不監聽或自動偵測 activation 後的外部 Git config 變更。
- 不驗證既有 `core.hooksPath` 是否指向 `.githooks/`。
- 不覆寫、合併或刪除 workspace 內既有 hook 檔案。
- 不修改 global 或 system Git config。
- 不在 Status Bar 點擊時執行 Install。
