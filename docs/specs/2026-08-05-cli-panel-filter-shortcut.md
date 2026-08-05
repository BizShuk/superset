# CLI Panel Filter 快捷鍵與 Focus Restoration

- 日期:2026-08-05
- 狀態:已實作 (`0.33.5`)
- 相關規格:[`2026-08-04-cli-launcher-path-filter.md`](2026-08-04-cli-launcher-path-filter.md)

## 問題 (Problem)

CLI project list 的 Filter 原本只能從 View Title Action 啟動。keyboard navigation 的使用者
必須離開專案清單去操作按鈕，而且送出 Filter Input Box 後，keyboard focus 沒有明確回到
CLI panel，不能立即繼續選取或啟動 project。

## 決策 (Decision)

- `Ctrl+T` 直接呼叫既有 `CLI: Filter Paths`，不新增平行 command 或 filter state。
- 快捷鍵只在 CLI panel 本身取得 focus 且目前不是 input focus 時生效，不覆蓋 editor、
  terminal 或其他 View 的 `Ctrl+T`。
- 按 `Enter` 接受 query 後，無論套用新條件或以空字串清除條件，focus 都回到 CLI
  project list；按 `Esc` 維持既有 query。
- query 仍是 ephemeral UI state，不寫入 settings 或 `globalState`。

## 使用流程 (User Flow)

1. Focus CLI panel。
2. 按 `Ctrl+T`，輸入與 View Title Action 相同的 path filter。
3. 按 `Enter` 套用，接著直接用 keyboard 在已過濾的 project list 上操作。

## 驗證 (Verification)

- Manifest contract 確認 `Ctrl+T` 綁定同一個 Filter command，並受 CLI View focus 與
  input focus 限制。
- Activation regression 確認 accepted Filter input 後會執行 CLI View focus transition。
- 完整 Vitest suite、TypeScript compile、VSIX packaging 與 VSIX content verification
  作為 deterministic acceptance；實際 VS Code 的 keyboard interaction 仍以安裝後的
  Extension Host smoke test 為 visual/runtime acceptance。
