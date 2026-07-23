# Install Skills Command Title

## 狀態

已實作。

## 行為

Skill repository 安裝命令的使用者可見名稱統一為
`Superset: Install Skills`。命令面板、repository Quick Pick 標題與執行安裝的
terminal 名稱使用相同文字。

既有 command ID `superset.skillInstall` 保持不變，程式呼叫端與快捷鍵設定不需遷移；
安裝流程仍以 `skills add <repository>` 執行。

## 驗證契約

- `test/packageManifest.test.ts` 固定 manifest 的使用者可見命令名稱。
- `test/installCommands.test.ts` 固定 Quick Pick 與 terminal 名稱。
