# Terminal Activity Sources `A` + `B`

## 狀態

已實作。落地於 v0.20.0。

## 動機

`markUnseen` 只需要`每個 terminal 一個 bool`——「這裡發生了你還沒看過的事」。
取得這個 bool 的兩條既有路徑都按`輸出位元組量`收費，而且都收在
extension host 主執行緒上：

| 既有路徑 | 成本 |
| --- | --- |
| `PtyTerminalHost.detectActivity` | 持有 master PTY，每個 byte 經 EH 主執行緒 |
| `OutputWatcher` + `createShellExecutionSource` | 排空 `execution.read()`，且每個 chunk 做一次 `JSON.stringify` + OutputChannel `appendLine` |

`log` 在 `src/extension.ts:43` 完全未 gate，所以第二條路徑在
`find /` 這類輸出下會把 EH 主執行緒餵滿字串配置與 IPC，
表現為`所有 terminal 同時斷線`。

本規格引入兩個`零位元組`的偵測來源，取代上述路徑成為預設。

## 範圍

新增五個模組，全部與 `vscode` 解耦或只在 adapter 邊界接觸：

| 檔案 | 職責 | `vscode` import |
| --- | --- | --- |
| `src/terminals/activitySource.ts` | `ActivitySource` 契約 + `ActivityCoordinator` | 無 |
| `src/terminals/processTreeSampler.ts` | `ps` 輸出解析與兩次取樣的差分判定 | 無 |
| `src/terminals/processActivitySource.ts` | 來源 `A` 的輪詢政策 | 無 |
| `src/terminals/shellIntegrationActivitySource.ts` | 來源 `B` 的事件政策 | 無 |
| `src/terminals/processSnapshot.ts` | `ps` 執行與 pid 解析 adapter | 有 |

`createVscodeLifecycleSubscribers` 加在既有的
`src/terminals/shellExecutionSource.ts`（該檔本來就是 vscode adapter）。

## 行為

### 來源 `B` — shell integration 生命週期

訂閱 `onDidStartTerminalShellExecution` 與
`onDidEndTerminalShellExecution`，`絕不呼叫 execution.read()`。

- `start` —— 使用者沒在看的 terminal 啟動了指令
- `end` —— 指令結束。兩者中較強的訊號：背景 build / test 跑完了

兩個 edge 都 emit；是否真的翻 badge 由 coordinator 決定。

### 來源 `A` — 進程樹輪詢

覆蓋 shell integration 看不進去的全螢幕 TUI（`claude`、`codex`、`vim`）——
那些程式的 execution 會維持開啟整個生命週期，`B` 只看得到頭尾。

每次 poll 執行`一次` `ps -axo pid=,ppid=,time=,comm=`，供`所有` terminal 共用。
無 tracked terminal 時完全不執行 `ps`。

判定規則（`diffSamples`，依序）：

| # | 條件 | 結果 |
| --- | --- | --- |
| 1 | 目前無子孫進程 | idle（shell 在 prompt） |
| 2 | 無前次取樣 | idle（baseline，避免啟用瞬間標記全部） |
| 3 | 子孫 pid 集合改變 | active |
| 4 | 累積 CPU 時間 delta ≥ `10ms` | active |

用累積 CPU 時間（`ps -o time=`）而非 `%cpu`：macOS 的 `%cpu` 是自 process
啟動以來的衰減平均，一次爆發幾乎不動，長期閒置又留著過時非零值。
`time=` 每個 process 單調遞增，兩次取樣的差就是「該視窗內消耗的 CPU」。

`shell 自身`的 CPU 不計入——互動式 shell 每次 prompt 重繪都會累積一點，
計入會讓每個閒置 terminal 看起來都在忙。要偵測的是`前景程式`，那永遠是子行程。

`10ms` 門檻對齊 `ps` 的 centisecond 解析度，低於此無法與捨入雜訊區分。

其他約束：

- 下一 tick 只在當前 tick settle 後排程 —— 慢或卡住的 `ps` 不會疊加 timer
- poll 失敗只記錄不中斷迴圈（`ps` 在 fork 壓力下會 transient 失敗）
- timer `unref()` —— 遞迴排程鏈否則會自行持有 Node event loop
- `ps` 加 `timeout` 與 `maxBuffer` 上限
- pid 快取於 `WeakMap`，`processId` 是只 settle 一次的 promise
- pseudoterminal-backed terminal 的 `processId` 解析為 undefined，此來源略過

### `ActivityCoordinator`

單一決策點。抑制政策（原本複製在 `OutputWatcher` 與
`PtyTerminalHost.detectActivity` 兩處）收斂於此：

```text
不在 registry        -> 丟棄
是當前 focus 的       -> 丟棄
最近 focus 過的       -> 丟棄
已經是 unseen        -> 丟棄（同時是 log 去重點）
否則                 -> log 一行 + markUnseen
```

日誌紀律：`只在 seen → unseen 真的翻轉時`寫一行。被抑制的路徑是熱路徑
（閒置但 focus 中的 terminal 每次 poll 都會產生事件），逐事件記錄會重演
「診斷 channel 本身變成效能問題」。

### 既有 `OutputWatcher` 降為 opt-in

新增設定 `superset.terminals.legacyOutputWatcher`（`boolean`，預設 `false`）。
預設關閉即代表讀取位元組的路徑不再啟用。

`PtyTerminalHost` 與 auto-replace 本次`不動`。

## 改動檔案

| 檔案 | 改動 |
| --- | --- |
| `src/terminals/activitySource.ts` | 新增 |
| `src/terminals/processTreeSampler.ts` | 新增 |
| `src/terminals/processActivitySource.ts` | 新增 |
| `src/terminals/shellIntegrationActivitySource.ts` | 新增 |
| `src/terminals/processSnapshot.ts` | 新增 |
| `src/terminals/shellExecutionSource.ts` | 新增 `createVscodeLifecycleSubscribers` |
| `src/terminals/index.ts` | 接上 `ActivityCoordinator`；`OutputWatcher` 改為條件建立並加入 disposables |
| `package.json` | 新增 `Superset Terminals` configuration section；version 0.19.0 → 0.20.0 |
| `test/processTreeSampler.test.ts` | 新增 25 case |
| `test/processActivitySource.test.ts` | 新增 14 case |
| `test/shellIntegrationActivitySource.test.ts` | 新增 13 case |
| `test/activityCoordinator.test.ts` | 新增 10 case |

## Verification

| 步驟 | 指令 | 結果 |
| --- | --- | --- |
| 型別檢查 | `npx tsc --noEmit` | 0 error |
| 新增測試 | `npx vitest run test/processTreeSampler.test.ts test/processActivitySource.test.ts test/shellIntegrationActivitySource.test.ts test/activityCoordinator.test.ts` | 62/62 通過 |
| 完整測試 | `npx vitest run` | 906 通過 / 6 失敗（皆為 backpressure 待辦，與本次無關） |
| 完整 build | `npm run build` | `superset-0.20.0.vsix` 15.35 MB，verify-vsix 通過 |
| 真實機器驗證 | 一次性 live test（未納入 suite） | 忙碌子行程判為 `cpu +` active；`sleep` 子行程判為 idle |

## 已知限制

- `ps` 依賴 POSIX。Windows 上 `runPsSnapshot` 會 reject，來源 `A` 每 tick
  記錄一次錯誤後空轉；來源 `B` 不受影響。Windows 支援需另開 plan。
- 偵測粒度為 poll interval（預設 `1s`），不像位元組路徑那樣即時。
  對「背景 terminal 有動靜」這個用途足夠。
- 來源 `A` 看不出「有輸出但不耗 CPU」的情況（例如被 pipe 餵資料的
  程式長時間 block）。此類情形由來源 `B` 的 execution edge 覆蓋。
- `test/ptyTerminalHost.backpressure.test.ts` 的 6 個失敗本規格不處理；
  已於 v0.21.0 由 [`2026-07-26-pty-backpressure-and-lifecycle-hardening.md`](2026-07-26-pty-backpressure-and-lifecycle-hardening.md) 解決。
