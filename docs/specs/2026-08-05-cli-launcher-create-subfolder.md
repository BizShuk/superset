# CLI Launcher：建立子資料夾

2026-08-05 實作。CLI View 的 path row Edit menu 新增 `Create Subfolder`，讓使用者
不必離開面板，即可在 Pinned Path 或 Scanned Folder 下建立 direct child directory。

## 行為契約 (Behavior Contract)

- 命令沿用 CLI Launcher 的 selection resolution：context menu、目前 selection 與
  Command Palette quick pick 都解析成一組 paths，重複 path 只處理一次。
- 單選與多選都只詢問一次名稱；多選時在每個 resolved path 下建立同名 folder。
- 名稱先 trim，再拒絕空白、`.`、`..`、`/`、`\` 與 NUL。只接受一個 path segment，
  不把 nested relative path 或 absolute path 當成名稱。
- 建立採 non-recursive semantics；parent 不存在、不是 directory、child 已存在或權限
  不足都視為失敗，不自動補 parent，也不覆蓋既有內容。
- 至少建立一個 folder 後會刷新 CLI View。固定兩層 scan depth 與目前 filter 仍是顯示
  邊界，因此落在掃描範圍外或不符合 filter 的新 folder 不會出現在 tree。
- 命令不修改 `superset.cliLauncher.*` settings、不自動 pin path、不建立 terminal，
  也不委派 agent CLI。

## UI 與 Command

| 項目 | 值 |
| --- | --- |
| Command ID | `superset.cliLauncherCreateSubfolder` |
| 顯示名稱 | `Create Subfolder` |
| 適用列 | Pinned Path、Scanned Folder |
| Context menu group | `2_modify@1` |
| 後續動作 | `Remove from Panel` (`2_modify@2`) |

Input Box 取消時不做任何事。validation、filesystem 或 permission error 會進入既有
CLI Launcher diagnostic log，並顯示可見 error message；不會靜默失敗成按鈕無反應。

## 驗證邊界 (Verification Boundary)

Automated tests 驗證 command registration、manifest menu order、direct-name validation、
trim、多選 filesystem creation 與 provider refresh。實際 Edit menu 排序、Input Box
validation 呈現，以及 refresh 後的 Tree View 展開狀態仍以 VS Code Extension
Development Host 驗收為準。
