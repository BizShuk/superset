# Backpressure 防護 for `PtyTerminalHost`

## Context

PTY-backed terminal 有時會觸發「所有 VS Code terminal 同步斷線」。已透過
`systematic-debugging` 流程判定最可能根因：

- `proc.onData` 同步 fan-out 到 `fireWrite` + `dataListeners`
- 任一 listener 阻塞 → event loop 飢餓 → VSCode ptyHost heartbeat timeout
- `node-pty` 暴露 `pause()` / `resume()`，整個專案從未使用

已完成前置作業：

| 動作 | 檔案 |
| --- | --- |
| 移除 mermaid 偵測（buffer + link provider + trigger） | `src/terminals/index.ts`、`src/mermaid/*`、`test/mermaid*.test.ts` |
| 寫入 failing backpressure 測試（7 case） | `test/ptyTerminalHost.backpressure.test.ts` |

預期結果：大量輸出時 native pipe 不會無限堆積；listener 拋例外不再中斷
fan-out；測試從 1/7 通過變 7/7 通過。

## 設計決策（使用者已確認）

| 項目 | 決策 |
| --- | --- |
| Watermark 值 | VS Code setting 可調：`superset.terminals.highWaterMark`、`superset.terminals.lowWaterMark`；範圍 `1–64 MiB`；預設 4 MiB / 1 MiB |
| 診斷日誌 | 每次 `pause` / `resume` 切換都記錄到現有 `log` channel |

## 介面擴充

### `src/terminals/ptyTerminalHost.ts`

| 項目 | 改動 |
| --- | --- |
| `PtyProcess` interface | 新增 `pause?(): void` 與 `resume?(): void`（optional，保留 fake 測試彈性） |
| `PtyTerminalHostDeps` | 新增 `getConfig?: () => { highWaterMark: number; lowWaterMark: number }`（nullable，給純函式測試用） |
| `PtyTerminalHost` 內部狀態 | `private pendingBytes = 0` / `private paused = false` / `private drainTimer?: NodeJS.Immediate` |
| 常數 | `DEFAULT_HIGH_WATER_MARK = 4 * 1024 * 1024` / `DEFAULT_LOW_WATER_MARK = 1 * 1024 * 1024` / `MIN_WATER_MARK = 1024 * 1024` / `MAX_WATER_MARK = 64 * 1024 * 1024` |

### `src/terminals/ptyTerminalFactory.ts`

| 項目 | 改動 |
| --- | --- |
| `PtyProcess` handle | `pause` 與 `resume` 接到 `proc.pause` / `proc.resume`（已存在於 node-pty typings） |

## 實作要點

### Backpressure 狀態機

```text
proc.onData(data):
    bytes = Buffer.byteLength(data)
    pendingBytes += bytes

    if !paused && pendingBytes >= highWaterMark:
        paused = true
        proc.pause?.()
        log("[pty] backpressure PAUSE pendingBytes=${pendingBytes}")

    fireWrite(data)
    detectActivity(data)

    if paused && !drainTimer:
        drainTimer = setImmediate(() => {
            drainTimer = undefined
            pendingBytes = 0
            if paused && pendingBytes <= lowWaterMark:
                paused = false
                proc.resume?.()
                log("[pty] backpressure RESUME")
        })
```

### Watermark 讀取

- `PtyTerminalFactory` 在 `spawn` 時透過 `vscode.workspace.getConfiguration("superset.terminals")` 讀取 `highWaterMark` 與 `lowWaterMark`
- 數值夾在 `[MIN_WATER_MARK, MAX_WATER_MARK]`，且 `lowWaterMark < highWaterMark`；不符合預設值
- 傳入 `PtyTerminalHost` 透過新 `getConfig` dep（closure 形式以利測試注入固定值）

### `close()` 清理

```text
close():
    if !opened: return
    opened = false
    if drainTimer: clearImmediate(drainTimer); drainTimer = undefined
    if paused:
        paused = false
        proc.resume?.()
        log("[pty] backpressure RESUME (close)")
    try: proc?.kill() catch err: log("[pty] kill error: ${err}")
    proc = undefined
    pendingBytes = 0
    fireClose()
```

### `fireWrite` 例外隔離

```text
fireWrite(data):
    for cb of writeListeners:
        try: cb(data)
        catch err: log("[pty] write listener ERROR: ${err}")
```

理由：`fireWrite` listener 迴圈本身就需要 try/catch 隔離（v0.18.0 起
`PtyTerminalHost.fireWrite` 已預設包 try/catch），listener throw 不應中斷
fan-out，也不應影響 backpressure 計數。本段為對齊既有實作。

> ⚠️ Stale (v0.18.0) — 原理由引用 `PtyTerminalFactory.dataListeners`
> （`ptyTerminalFactory.ts:118-127`）為對齊對象；該 Set 與 fan-out
> 已於 v0.18.0 隨 mermaid detection 移除整段刪除。此段仍有效，但
> 對齊對象改成 `fireWrite` 本身。

## 改動檔案

| 檔案 | 改動 |
| --- | --- |
| `src/terminals/ptyTerminalHost.ts` | `PtyProcess` 加 optional `pause`/`resume`；`PtyTerminalHostDeps` 加 `getConfig`；class 內加 `pendingBytes`/`paused`/`drainTimer` 與 watermark 常數；`onData` 內插 backpressure 邏輯；`close()` 加 drainTimer 清理與 paused 補 `resume()`；`fireWrite` listener 迴圈包 try/catch |
| `src/terminals/ptyTerminalFactory.ts` | `createNodePtySpawner` handle 補 `pause`/`resume` 接到 native proc；`PtyTerminalFactory.spawn` 從 VS Code configuration 讀取 watermark 並傳入 `PtyTerminalHost` |
| `package.json` | 新增 `contributes.configuration` 兩個 property：`superset.terminals.highWaterMark`（`number`，min 1，max 64，預設 4，單位 MiB）與 `superset.terminals.lowWaterMark`（`number`，min 1，max 64，預設 1） |

## 不動的部分

- `src/mermaid/` 已只剩 preview command；不參與 backpressure 路徑
- `src/terminals/outputWatcher.ts` 使用 VSCode shell integration 事件，與 node-pty 無關
- `TerminalRegistry.markUnseen` 已 idempotent，不需 backpressure

## 既有測試影響

- `test/ptyTerminalHost.test.ts`：fake `PtyProcess` 沒有 `pause`/`resume` 仍合法（optional）；既有 28 case 預期全綠
- `test/ptyProcessContract.test.ts`：contract 測試需更新以反映新 optional method（或保留 optional 設計即可）
- `test/ptyTerminalHost.backpressure.test.ts`：現有 7 case，實作落地後應從 1/7 變 7/7

## Verification

| 步驟 | 指令 |
| --- | --- |
| 型別檢查 | `npx tsc --noEmit` |
| 單元測試 | `npm test -- test/ptyTerminalHost.test.ts test/ptyTerminalHost.backpressure.test.ts test/ptyProcessContract.test.ts` 預期全綠 |
| 完整測試 | `npm test` 預期 71+ 檔案全綠 |
| 完整 build | `npm run build` 預期 `superset-<version>.vsix` 驗證通過 |
| 手動驗證 | 在 dev container 開啟一個 PTY-backed terminal，執行 `yes` 或 `find / -print` 5 秒，確認未觸發其他 terminal disconnected；觀察 OutputChannel 是否出現 `[pty] backpressure PAUSE` 與 `RESUME` |

## 後續可選（非本次範圍）

- 若實測發現 watermark 仍觸發頻繁，可考慮 chunk coalescing：將同 tick 內多個 `onData` chunk 累積成單一 `fireWrite`
- 若 VSCode setting 動態變更需要生效，可在 `PtyTerminalHost` 內訂閱 `vscode.workspace.onDidChangeConfiguration` 並即時更新 `highWaterMark` / `lowWaterMark`