# Skill Install Repository Quick Pick

## 使用者介面

`Superset: Skill Install` 使用 Quick Pick 下拉選單，不再要求使用者手動輸入 GitHub repository。

選項順序固定為：

1. `bizshuk/cc-plugin`（預設）
2. `anthropics/claude-plugins-official`
3. `anthropics/skills`

第一個選項是開啟 Quick Pick 時的預設焦點，按 `Enter` 即安裝 `bizshuk/cc-plugin`。按 `Esc` 或關閉 Quick Pick 不會建立 terminal，也不會執行安裝。

## 執行契約

- 選取 repository 後，以既有 Run Terminal 執行 `skills add <repository>`。
- 安裝成功時 terminal 依既有 `closeOnSuccess` 行為自動關閉；失敗時保留 terminal 供使用者檢查輸出。
- 受信任的程式呼叫端仍可傳入 `{ repo }`，直接安裝指定 repository 並略過 Quick Pick。

## 驗證

`test/installCommands.test.ts` 覆蓋選項順序、預設標示、Anthropic repository 選取、程式參數與取消操作。
