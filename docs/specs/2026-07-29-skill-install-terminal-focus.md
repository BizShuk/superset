# Skill Install Terminal Focus

## 狀態

已實作。

## 行為

執行 `Superset: Install Skills` (`superset.skillInstall`) 命令時，產生的 PTY-backed terminal 會自動聚焦 (`preserveFocus: false`)，方便使用者在 terminal 中對 `skills add` 進行互動操作。

`spawnRunTerminal` 支援 `preserveFocus?: boolean` 選項，預設值為 `true`（保持既有行為不強行奪取 focus）；`skillInstall` 明確傳入 `{ preserveFocus: false }` 以移轉 focus 至 terminal 面板。

## 驗證契約

- `test/installCommands.test.ts` 驗證 `skillInstall` 呼叫 `terminal.show(false)`。
- `test/installCommands.test.ts` 驗證 `spawnRunTerminal` 接受 `preserveFocus` 選項並正確傳遞給 `terminal.show()`。
