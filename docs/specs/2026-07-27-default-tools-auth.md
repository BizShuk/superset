# Default Tools: auth

## 狀態

已實作。

## 變更

`Superset: Install Default Tools` (`superset.installDefaultTools`) 在既有六個 CLI 後，依固定順序新增第七個安裝命令：

7. `go install github.com/bizshuk/auth@master`

`src/installCommands.ts` 的 `DEFAULT_TOOLS` 仍是清單唯一來源；安裝流程與既有工具相同，每個命令在獨立的 Run Terminal 執行並於成功後關閉 shell。
