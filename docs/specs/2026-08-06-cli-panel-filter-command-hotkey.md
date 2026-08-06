# CLI Panel Filter Command Hotkey

## 範圍 (Scope)

CLI View 的 path filter hotkey 從 `Ctrl+F` 改為 `Cmd+F`。本規格只取代
[`2026-08-06-cli-panel-filter-hotkey.md`](2026-08-06-cli-panel-filter-hotkey.md)
中的 shortcut 值；既有 Filter command、ephemeral query 與 focus restoration
契約維持不變。

## 行為 (Behavior)

- CLI View focused 且沒有 Input focus 時，`Cmd+F` 啟動既有
  `CLI: Filter Paths`。
- 其他 View、Editor、Terminal 或 Input focused 時不攔截 `Cmd+F`。
- Input Box 按 `Enter` 接受後，focus 回到 CLI View；按 `Esc` 維持既有 query。
- `Ctrl+F` 不再由 CLI Launcher 綁定。

## 驗證 (Verification)

- Manifest contract 鎖定 `Cmd+F` 與
  `focusedView == superset.cliLauncher.paths && !inputFocus`。
- Automated tests 與 VSIX verification 不取代 Extension Development Host 的實際
  keyboard focus acceptance。
