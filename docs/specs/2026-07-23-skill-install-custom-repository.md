# Skill Install Custom Repository

## 狀態

已實作。

## 使用者流程

`Superset: Install Skills` 的 Quick Pick 保留既有八個 curated repositories 與順序，
並在清單末尾加入永遠可見的 `自訂 repository…`：

1. 選取 `自訂 repository…`。
2. Input Box 要求輸入 GitHub repository identifier，例如 `owner/repository`。
3. 輸入值去除頭尾空白後，交由 Run Terminal 執行安裝。

關閉 Quick Pick、關閉 Input Box 或未提供有效的非空輸入時，不建立 Run Terminal。

## 執行與安全契約

- Curated 與自訂來源共用 `skills add <repository>` 執行路徑。
- Repository 值一律透過 `quoteShellArg` 成為單一 shell argument，避免自訂輸入改變
  shell command 結構。
- 受信任的程式呼叫端仍可使用 `{ repo }` 略過 Quick Pick 與 Input Box。
- `closeOnSuccess: true` 行為不變：成功時 terminal 自動關閉，失敗時保留輸出。

## 驗證契約

`test/installCommands.test.ts` 覆蓋：

- Curated repository 順序與末尾自訂項目。
- 自訂輸入的 trim、Input Box 非空驗證與 shell quoting。
- 關閉自訂 Input Box 時不建立 terminal。
- Curated 與程式參數路徑仍正常安裝。
