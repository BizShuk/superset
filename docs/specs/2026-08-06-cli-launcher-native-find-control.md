# CLI Launcher Native Find Control

## 狀態

已實作於 `0.35.3`。本規格取代 extension-owned path filter 的 current behavior；
舊規格保留為歷史記錄。

## 需求

CLI View 的搜尋改用 VS Code Tree/List 原生 Find Control，外觀與操作跟其他原生
Tree View 一致：

- `Filter Paths` 與 CLI View 內的 `Cmd+F` 開啟同一個 native control。
- 每個 Extension Host runtime 第一次開啟時預設為 `Filter` + `Fuzzy Match`。
- 第一次套用預設後，保留使用者在本次 runtime 內切換的 Find Mode 與 Match Type。
- 不修改使用者或 workspace 的全域 `workbench.list.*` settings。
- 不使用 Proposed API。

## 行為差異

舊的 modal input、逐段 subsequence engine、provider query state、view description 與
`Clear Filter` command 全部移除。搜尋 query、即時 filtering、清除與關閉行為都由
VS Code native control 擁有。

Native query 不會暴露給 extension，因此 `Copy All Paths` 的定義調整為複製完整 CLI
catalog，不再跟隨畫面上的搜尋結果。

## Command 與 Scope

`superset.cliLauncherFilter` 保留原 command ID；執行時先將 focus 放到
`superset.cliLauncher.paths`，套用本 runtime 的初始 Find toggles，再開啟 native
control。`Cmd+F` 的條件維持：

```text
focusedView == superset.cliLauncher.paths && !inputFocus
```

Command Palette 與 CLI View title action 仍可使用同一 command。

## 驗證契約

- Manifest 只保留 `Filter Paths`，沒有 `Clear Filter` command 或 menu item。
- 第一次啟動 command 時依序 focus CLI View、套用 `Filter` / `Fuzzy Match`、開啟
  native Find Control。
- 同一 runtime 再次啟動只 focus 並開啟 Find Control，不重設使用者 toggles。
- `Cmd+F` keybinding 與原本的 CLI View focus boundary 保持不變。
