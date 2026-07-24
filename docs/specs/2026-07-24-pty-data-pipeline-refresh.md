# PTY Data Pipeline Refresh

## 狀態

已實作。落地於 v0.18.0。

## 動機

`src/terminals/ptyTerminalFactory.ts` 與 `ptyTerminalHost.ts` 是
Superset PTY-backed terminal 的核心 data path。歷經 mermaid 偵測
移除後 (v0.17.0)，三個問題浮現：

1. **依賴過舊**：`@homebridge/node-pty-prebuilt-multiarch` ^0.13.1
   fork 自 upstream node-pty 0.x；upstream 自 1.0 起改寫並由 Microsoft
   維護，prebuild 與跨平台一致性更佳。
2. **`dataListeners` 變 dead code**：mermaid buffer 移除後，
   `PtyTerminalFactory.onData` Set 0 訂閱者，每次 `proc.onData` 仍
   跑一次空 `for` loop；JSDoc 引用已過時。
3. **無 chunk coalescing**：每個 native → JS chunk 直接透過
   `vscode.Pseudoterminal.onDidWrite` 送 IPC，高頻輸出場景
   （`cat large-file`、`find /`）渲染端 parse 成本高。

## 範圍

- 依賴從 `@homebridge/node-pty-prebuilt-multiarch` 切換為 upstream
  `node-pty` ^1.1.0
- `PtyTerminalFactory.onData` Set 與 fan-out 整段移除
- `PtyTerminalHost` 對 `vscode.Pseudoterminal.onDidWrite` 加入
  `setImmediate` 邊界 chunk coalescing

## 行為

### 依賴切換

```text
"dependencies": {
  "multicast-dns": "^7.2.5",
  "node-pty": "^1.1.0",
}
```

- `@homebridge/node-pty-prebuilt-multiarch` ^0.13.1 移除
- `node-pty` ^1.1.0 新增
- `package-lock.json` 由 `npm install` 重生
- `package.json#version` 0.17.0 → 0.18.0

CLI 介面 (`spawn(file, args, options)`) 與 `IPty` 物件的
`onData` / `onExit` / `write` / `kill` / `resize` 與舊版完全相容，
不需要更動 `PtySpawner` 抽象。

### `dataListeners` 移除

`PtyTerminalFactory` 內：

- `private readonly dataListeners = new Set<...>` 刪除
- `onData(cb)` method 刪除（含 JSDoc）
- `spawn` 內 `host.onWrite((data) => for (cb of dataListeners) ...)`
  fan-out callback 刪除（含上方解釋 mermaid buffer 的 JSDoc）

`grep -RnE "factory.onData|ptyTerminalFactory.onData"` 結果為空，
確認無 source-tree 訂閱者。

### Chunk Coalescing

`PtyTerminalHost` 內新增兩個 private 欄位：

```typescript
private writeBuffer = "";
private pendingFlush: NodeJS.Immediate | null = null;
```

`proc.onData` callback 改為：

```typescript
this.proc.onData((data) => {
    this.bufferWrite(data);   // 取代原本 this.fireWrite(data)
    this.detectActivity(data);
});
```

`bufferWrite(data)` 將 chunk 累入 `writeBuffer`，若 `pendingFlush`
尚未排程則 `setImmediate(() => flush)`：

```typescript
private bufferWrite(data: string): void {
    this.writeBuffer += data;
    if (this.pendingFlush !== null) {
        return;
    }
    this.pendingFlush = setImmediate(() => {
        this.pendingFlush = null;
        const out = this.writeBuffer;
        this.writeBuffer = "";
        if (out.length > 0) {
            this.fireWrite(out);
        }
    });
}
```

`close()` 與 `proc.onExit` 兩個出口都先呼叫 `flushWriteBuffer()`，
確保 tail bytes 不會因為 proc 死掉而遺失。`flushWriteBuffer` 會
`clearImmediate` 殘留 timer 並立即送出 `writeBuffer`。

`detectActivity` 仍**per-chunk**觸發，確保 `markUnseen` 時機精準
（高頻 TUI redraw 時 `unseenLogged` WeakSet + `markUnseen` idempotent
已能自我去重）。

`fireWrite` 內 listener 迴圈包 `try/catch`（listener 丟例外不影響
後續 chunk coalescing 與 pause/backpressure 計數）。

### Coalescing 語意

| 事件順序 | 結果 |
| --- | --- |
| `proc.onData("a")` → `proc.onData("b")` → `proc.onData("c")` 同 tick | listener 收到 `"abc"` 一次 |
| flush 後再 `proc.onData("z")` | listener 收到 `"z"`（獨立 emit） |
| `proc.onData("tail")` 然後 `close()` | listener 收到 `"tail"`（close 強制 flush） |
| Listener 拋例外 | coalescing 繼續；下一個 listener 仍收到 joined chunk |
| `detectActivity` | 每個 chunk 觸發一次（無 coalescing） |

## 改動檔案

| 檔案 | 改動 |
| --- | --- |
| `package.json` | 移除 `@homebridge/node-pty-prebuilt-multiarch`；新增 `node-pty` ^1.1.0；version 0.17.0 → 0.18.0 |
| `package-lock.json` | 由 `npm install` 重生 — 移除 37 個 homebridge 套件、新增 1 個 `node-pty` |
| `src/terminals/ptyTerminalFactory.ts` | import 改為 `"node-pty"`；移除 `dataListeners` Set、`onData()` method、fan-out callback |
| `src/terminals/ptyTerminalHost.ts` | JSDoc 引用改為 upstream `node-pty`；新增 `writeBuffer` / `pendingFlush` 狀態；新增 `bufferWrite()` 與 `flushWriteBuffer()` private method；`proc.onData` 改用 `bufferWrite`；`close()` 與 `proc.onExit` 呼叫 `flushWriteBuffer`；`fireWrite` 與 `fireClose` listener 迴圈包 `try/catch` |
| `CLAUDE.md` | Invariant 改為 `node-pty` 是 runtime PTY binding；外部 API 連結改為 upstream GitHub |
| `test/ptyTerminalHost.coalescing.test.ts` | 新增 8 個 coalescing 測試 |
| `test/ptyTerminalHost.test.ts` | 新增 suite-level `beforeEach`/`afterEach` fake timers；`forwards data to write listeners` 加 `vi.runAllTimers()` |
| `test/ptyProcessContract.test.ts` | `open() spawns ...` 改用 fake timers + `runAllTimers()`，並驗證兩個 chunk 合併為 `"helloworld"` |

## 互動點

- **`plans/radiant-doodling-hammock.md`** (backpressure) 是 in-progress plan。
  本 spec 落地後：
  - 該 plan line 106-107 引用 `dataListeners` 變 stale，下次 backpressure
    實作時刪除那段 reference
  - 新增的 `bufferWrite` 與該 plan 的 `setImmediate` drain tick 共存，
    後者排在自己的 immediate callback，不同 `setImmediate` 各自獨立
- **既有 `test/ptyTerminalHost.backpressure.test.ts` 7 case**：1 通過
  （低流量 negative case），6 失敗（待 backpressure plan 實作）。
  本 spec 不解 backpressure。

## Verification

| 步驟 | 指令 | 結果 |
| --- | --- | --- |
| 型別檢查 | `npx tsc --noEmit` | 0 error |
| 既有 PTY 測試 | `npm test -- test/ptyTerminalHost.test.ts test/ptyProcessContract.test.ts` | 27/27 通過 |
| 新增 coalescing 測試 | `npm test -- test/ptyTerminalHost.coalescing.test.ts` | 8/8 通過 |
| 完整測試 | `npm test` | 701 通過 / 6 失敗（皆為 backpressure 待辦） |
| 完整 build | `npm run build` | 產出 `superset-0.18.0.vsix` 15.33 MB，verify-vsix 通過 |
| VSIX 內容 | `unzip -l superset-0.18.0.vsix \| grep node-pty` | `darwin-x64`、`darwin-arm64`、`win32-x64` prebuilds 皆打包；`@homebridge` 完全 absence |

## 已知限制

- **Linux 無 prebuild**：`node-pty@1.1.0` upstream 對 Linux 採
  `node-gyp` 即時建置而非 ship prebuild。安裝時需要 build tools
  （`build-essential` + `python3`）。本專案未處理 Linux build
  path；如有需求需另開 plan。
- **4ms 典型延遲**：coalescing 邊界為 `setImmediate`，單次 emit
  延遲極小（次 ms 等級），人類無法察覺，但對自動化腳本可能略
  微影響 prompt 偵測；超低延遲需求可調為 `queueMicrotask` 或
  引入 config knob（目前不提供）。
