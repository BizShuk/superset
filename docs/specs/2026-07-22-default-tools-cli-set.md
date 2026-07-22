# Default Tools CLI Set

## 狀態

已實作。

## 行為

`Superset: Install Default Tools` (`superset.installDefaultTools`) 依固定順序，在各自的 Run Terminal 執行以下命令：

1. `go install github.com/bizshuk/pm2@master`
2. `go install github.com/bizshuk/skills@master`
3. `go install github.com/bizshuk/dux@master`
4. `go install github.com/bizshuk/port@master`
5. `go install github.com/bizshuk/sessiond@master`

每個命令會附加 `&& exit`；成功時該 terminal 的 shell 自動關閉，安裝輸出仍可在執行期間檢視。若 Terminals module 尚未提供 terminal spawner，命令顯示錯誤訊息並停止，不會執行任何安裝。

## 維護契約

- CLI 清單唯一來源為 `src/installCommands.ts` 的 `DEFAULT_TOOLS`。
- CLI 順序是使用者可觀察的行為，變更時須同步更新 `test/installCommands.test.ts` 與本規格。
- `Superset: Skill Install` 是獨立流程，負責執行 `skills add <repository>`，不屬於預設 CLI 安裝清單。
