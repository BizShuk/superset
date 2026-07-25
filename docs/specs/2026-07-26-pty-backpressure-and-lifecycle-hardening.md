# PTY Backpressure 與生命週期加固

## 狀態

已實作。落地於 v0.21.0。取代
`plans/2026-07-24-feat-pty-host-backpressure.md`（該 plan 已移除）。

## 動機

接續 [`2026-07-26-terminal-activity-sources-ab.md`](2026-07-26-terminal-activity-sources-ab.md)：
activity 偵測已改走零位元組路徑，但 PTY-backed terminal 的 data path
本身仍有兩類問題。

`Backpressure`：`proc.onData` 無條件累積進 `writeBuffer`，`pause()` /
`resume()` 從未使用。高輸出指令下 buffer 無上限成長，且單次 flush 會把
整批位元組一次交給 `vscode.Pseudoterminal.onDidWrite` 序列化。

`生命週期`：`onExit` 不清 `proc` 也不清 `opened`，之後每次 `handleInput`
都往死掉的 pty `write` 並被 `try/catch` 吞掉——`使用者打字完全沒反應`，
但 terminal 看起來還活著。另有 `fireClose` 重複觸發、`kill()` 無 escalation、
factory 的 terminal set 從不移除、factory 從未 dispose、`process.env` 未清洗。

## 設計：`pendingBytes` 是什麼

原 plan 與原測試把 `pendingBytes` 建模成`已交下游、待對方 ack`，
並由測試直接寫入該欄位模擬 consumer 排空。

`這個模型在 production 不存在`。`vscode.Pseudoterminal.onDidWrite` 是
fire-and-forget，renderer 不回 ack，因此沒有任何東西能遞減這個計數器——
pty 一旦 pause 就永遠不會 resume。

本規格改用`唯一可測量的佇列`：從 pty 收到、`尚未交給 onDidWrite` 的位元組。
這個佇列會在自己的 flush tick 上排空，resume 因此可達。

`pause()` / `resume()` 在 node-pty 委派到底層 `net.Socket`
（`lib/terminal.js:123,127`），是核心層的真 backpressure，不是 advisory。

## 行為

### Backpressure 狀態機

| 事件 | 動作 |
| --- | --- |
| `bufferWrite(data)` | `pendingBytes += byteLength(data)`；`>= highWaterMark` 且未 paused → `paused = true; proc.pause()` |
| flush tick | 送出至多 `MAX_FLUSH_BYTES`；`pendingBytes -= 送出量`；`<= lowWaterMark` 且 paused → `paused = false; proc.resume()`；buffer 仍有殘留則重排 flush |
| `close()` | 先 flush、paused 則補 `resume()`、歸零狀態、`kill()` 後排程 SIGKILL |

`MAX_FLUSH_BYTES = 1 MiB`：`onDidWrite` 的 payload 要跨 extension-host RPC
序列化且無 ack，單次 500 MiB emit 會把主執行緒卡住整個序列化時間。切片把
一次無上限的 stall 換成一連串有上限的，也正是讓 `pendingBytes` 能`逐步`
回落到 low watermark 的機制。1 MiB 遠高於實際單次 PTY read（64 KiB），
所以一般輸出仍然是每 tick 剛好一次 emit。

切片以 code unit 而非 byte 為界，並在切點落在 high surrogate 時回退一格——
從中間切開會把孤立 surrogate 交給 renderer 並毀掉該字元。

`flushWriteBuffer()`（teardown 用）刻意不套用 byte budget：那是關閉前的
最後一次 flush，扣住尾端等同直接遺失。

### Watermark 設定

`superset.terminals.highWaterMark` / `lowWaterMark`，單位 MiB，範圍 `1–64`，
預設 `4` / `1`。於 `open()` 時讀取一次，設定變更套用到之後開啟的 terminal。

`normalizeWaterMarks` 夾住範圍並修復`low >= high`（該情況下 low 永遠無法
由上方觸及，pty 會 pause 後永不 resume）。

### 生命週期修正

| 項目 | 修正 |
| --- | --- |
| exit 後輸入石沉大海 | `onExit` 清 `proc` / `opened`，並設 `disposed` |
| `open()` 在 close 後復活 shell | 新增 `disposed` 旗標；`opened === false` 只代表「目前未開」 |
| `onDidClose` 重複觸發 | `closeFired` guard |
| 對已死 proc 再 `kill()` | exit 路徑清空 `proc`，`close()` 不再有對象 |
| 忽略 SIGHUP 的前景程序殘留 | `close()` 後 `KILL_ESCALATION_MS`(2s) 升級 `SIGKILL`；proc 準時退出則取消 |
| paused 狀態下被 kill | `close()` 先補 `resume()`，否則 shell 可能卡在自己的 write 上收不到訊號 |
| factory terminal set 洩漏 | `Set` 改 `Map<Terminal, Host>`，`onDidCloseTerminal` 呼叫 `forget()` |
| factory 從未 dispose | 新增 `dispose()` 關閉所有仍持有的 host，並納入 feature disposables |
| auto-replace 未追蹤 timer | 150ms dispose timer 納入集合，teardown 時 `clearTimeout` |

### 環境清洗

`buildShellEnv` 取代直接傳 `process.env`：

- 移除 `ELECTRON_*`、`VSCODE_*` 前綴與 `NODE_OPTIONS`。extension host 跑在
  Electron 下且帶 `ELECTRON_RUN_AS_NODE`，原樣傳入會讓子 shell 裡任何
  node 系工具行為異常（Electron 的 node 把該旗標當模式切換）
- 明確設定 `TERM=xterm-256color`、`COLORTERM=truecolor`、`TERM_PROGRAM=vscode`。
  extension host 常常根本沒有 `TERM`，而認不出終端機的 TUI 會亂畫或卡在
  等待一個永遠不會來的 capability 回應

## 測試調整

原 `test/ptyTerminalHost.backpressure.test.ts` 有三個 case 無法實現，均源自
上述 ack 模型：

| 原 case | 問題 |
| --- | --- |
| `additional chunks while paused do not call pause again` | 期待 pause 終生只有一次；但 watermark 是循環，排空後新 burst 再次越過 HIGH 本就該再 pause |
| `drain tick with pending <= LOW calls resume` | 需要一個能跨越 `vi.runAllTimers()` 存活的 timer |
| `drain tick with pending still > LOW does NOT resume` | 同上 |

第二、三項在機制上不可能：實測確認 `vi.runAllTimers()` 結束後
`vi.getTimerCount() === 0`，而自我重排的 `setImmediate` 或 `setInterval`
會在 10000 次被 fake timer 判定為無窮迴圈並中止。

三個 case 改寫為同意圖但可實現的契約（paused 期間不重複 pause、排空後
resume 恰一次、單一 tick 的部分排空不 resume），並新增兩個補強
（pause/resume 循環可重複、超出 budget 的 burst 逐 tick 送完不遺失）。

## 改動檔案

| 檔案 | 改動 |
| --- | --- |
| `src/terminals/ptyTerminalHost.ts` | `PtyProcess` 加 `pause?` / `resume?` 與 `kill(signal?)`；watermark 常數與 `normalizeWaterMarks`；`pendingBytes` / `paused` / `disposed` / `closeFired` / `killTimer` 狀態；`drainOnce` byte budget；`applyBackpressure` / `releaseBackpressure`；`onExit` 與 `close()` 生命週期修正 |
| `src/terminals/ptyTerminalFactory.ts` | spawner 接上 `pause` / `resume` / `kill(signal)`；新增 `buildShellEnv`；`Set` → `Map` 加 `forget()` / `dispose()`；`readWaterMarkConfig` |
| `src/terminals/lifecycle.ts` | auto-replace 的 dispose timer 納入追蹤與 teardown |
| `src/terminals/index.ts` | `onDidCloseTerminal` 呼叫 `ptyFactory.forget`；`ptyFactory.dispose` 納入 disposables |
| `package.json` | 新增 `highWaterMark` / `lowWaterMark` 設定；version 0.20.0 → 0.21.0 |
| `test/ptyTerminalHost.backpressure.test.ts` | 3 case 改寫 + 2 case 新增（7 → 9） |
| `test/ptyTerminalHost.lifecycle.test.ts` | 新增 16 case |
| `test/ptyTerminalFactory.test.ts` | 新增 10 case |

## Verification

| 步驟 | 指令 | 結果 |
| --- | --- | --- |
| 型別檢查 | `npx tsc --noEmit` | 0 error |
| PTY 測試 | `npx vitest run test/ptyTerminalHost*.test.ts test/ptyProcessContract.test.ts test/ptyTerminalFactory.test.ts` | 全綠 |
| 完整測試 | `npx vitest run` | `940 通過 / 0 失敗`（首次全綠；先前的 6 個 backpressure 待辦已解） |
| 完整 build | `npm run build` | `superset-0.21.0.vsix` 15.35 MB，verify-vsix 通過 |
| node-pty binding | 檢視 `lib/terminal.js:123,127` | `pause` / `resume` 委派 `net.Socket`，核心層 backpressure |

## 已知限制

- `實機 PTY 驗證未執行`：開發沙箱擋掉 `posix_spawnp`，無法實際 spawn 一個
  shell 觀察 pause/resume。需要在真實 VS Code 中以 `yes` 或 `find /` 手動
  確認 OutputChannel 出現 `[pty] backpressure PAUSE` 與 `RESUME`。
- `onDidWrite 之後不可觀測`：VS Code 內部的緩衝與 renderer 之間沒有 ack，
  本規格只能保證`我們自己持有的佇列`有界。真正的端對端 backpressure 需要
  API 層支援，或把 PTY 移出 extension host（見
  [`2026-07-26-terminal-activity-sources-ab.md`](2026-07-26-terminal-activity-sources-ab.md) 的後續方向）。
- `auto-replace 仍為預設`：每個 plain panel terminal 仍會被替換成
  PTY-backed。縮小這個範圍（改為 opt-in）是獨立的一步，本規格未做。
