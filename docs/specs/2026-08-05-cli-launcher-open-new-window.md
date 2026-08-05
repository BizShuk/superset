# CLI Launcher：以新視窗開啟路徑

2026-08-05 實作。CLI View 的 path row context menu 新增 `Open in New Window`，
讓使用者不必先開 terminal，即可把 Pinned Path 或 Scanned Folder 直接開成獨立的
VS Code window。

## 行為契約 (Behavior Contract)

- 單選時，以新的 VS Code window 開啟該 path，既有 window 保持不變。
- 多選時，每個已選 path 各開一個新 window；重複 path 只處理一次。
- 命令參數沿用 CLI Launcher 的 selection resolution，支援 context menu、目前選取與
  Command Palette quick pick。
- 此動作不建立 terminal、不執行 agent CLI、不改動 `superset.cliLauncher.*`
  settings，也不碰磁碟內容。
- 開啟失敗時沿用 CLI Launcher 的 diagnostic log 與可見 error message boundary。

## UI 與 Command

| 項目 | 值 |
| --- | --- |
| Command ID | `superset.cliLauncherOpenNewWindow` |
| 顯示名稱 | `Open in New Window` |
| 適用列 | Pinned Path、Scanned Folder |
| Context menu group | `1_run@2` |

## 驗證邊界 (Verification Boundary)

Automated tests 驗證 command registration、manifest menu contract，以及單選／多選時均以
new-window semantics 開啟正確 path。實際 window 的呈現與 focus 行為仍以 VS Code
Extension Development Host 驗收為準。

