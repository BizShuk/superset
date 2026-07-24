# PTY Data Pipeline Refresh

## Context

`src/terminals/ptyTerminalFactory.ts` 與 `ptyTerminalHost.ts` 是 Superset
PTY-backed terminal 的核心 data path。經重新驗證，目前 codebase (v0.17.0)
有三個可處理的問題：

1. **依賴過舊**：`@homebridge/node-pty-prebuilt-multiarch` ^0.13.1 是 C++
   binding (`node-addon-api` + `binding.gyp`)，fork 自 upstream node-pty
   0.x 時代。`node-pty` upstream 自 v1.0 改寫為 Rust `portable-pty`，
   是 Microsoft 官方維護、prebuild 完整、跨平台一致。
2. **`dataListeners` 是 dead code**：`PtyTerminalFactory.onData()` Set
   為 mermaid buffer 設計，但 mermaid 偵測已於 v0.17.0 移除；目前 0 訂閱者。
   `ptyTerminalFactory.ts:82-85` JSDoc 仍指 mermaid file 是文件殘留。
   每次 `proc.onData` 多跑一次空 `for` loop。
3. **無 chunk coalescing**：native → JS 直接 `fireWrite(data)`，
   高頻輸出場景（`cat large-file`、`yes`、`find /`）每 byte 一次
   `vscode.Pseudoterminal.onDidWrite` IPC，渲染端 parse 成本高。

不包括 `plans/radiant-doodling-hammock.md` 的 backpressure 設計
（pause/resume watermark）—— 那份是獨立 in-progress plan，與本
plan 在 `proc.onData` 內可並存；本 plan 結束後那份 JSDoc 引用
`dataListeners` 的字句會自然過時，後續實作時順手更新即可。

## 設計決策

| 項目 | 決定 |
| --- | --- |
| Node-pty 套件 | `node-pty` ^1.1.0（upstream），取代 `@homebridge/node-pty-prebuilt-multiarch` |
| `dataListeners` 處理 | 整段移除（dead contract；JSDoc 與 factory dead hook 同步清掉） |
| Coalescing 機制 | `setImmediate` 邊界 flush；無超時延遲，無 config knob |
| `detectActivity` 時機 | 維持 per-chunk（markUnseen 需準確時機；不能被 coalescing 吃掉） |
| `fireWrite` 例外處理 | 沿用既有 `try/catch` 隔離（與 `PtyTerminalFactory` 既有模式對齊） |
| VS Code 設定 | 不新增（coalescing 是 always-on 的內部最佳化） |
| 版本 bump | 0.17.0 → 0.18.0（minor；node-pty swap 屬 maintenance + new platform support） |

## 改動檔案

### 1. `package.json` + `package-lock.json`

| 動作 | 細節 |
| --- | --- |
| 移除 dependency | `@homebridge/node-pty-prebuilt-multiarch` ^0.13.1 |
| 新增 dependency | `node-pty` ^1.1.0 |
| 同步 `package-lock.json` | 由 `npm install` 重生 |
| `version` | 0.17.0 → 0.18.0 |

### 2. `src/terminals/ptyTerminalFactory.ts`

- `import * as nodePty from "@homebridge/node-pty-prebuilt-multiarch"`
  → `from "node-pty"`
- 移除 `private readonly dataListeners = new Set<...>` (line 72-74)
- 移除 `onData(cb)` method (line 88-95，含 JSDoc)
- 移除 spawn 內 `host.onWrite((data) => { for (const cb of this.dataListeners) ... })`
  callback (line 118-127，含上方 JSDoc)
- `createNodePtySpawner` import comment 同步更新

### 3. `src/terminals/ptyTerminalHost.ts`

- Header JSDoc 從 `@homebridge/node-pty-prebuilt-multiarch` 改為 `node-pty`
- 新增 private 狀態：
  - `private writeBuffer = ""`
  - `private pendingFlush: NodeJS.Immediate | null = null`
- 新增 `private bufferWrite(data: string): void` ：
  - `writeBuffer += data`
  - 若 `pendingFlush` 已排程則 return
  - 否則 `pendingFlush = setImmediate(() => { flush 緩衝 + 呼叫 `fireWrite(joined)` })`
- `proc.onData` callback 將 `this.fireWrite(data)` 改為 `this.bufferWrite(data)`
- `close()` 流程：在 `proc.kill()` 之前，若 `pendingFlush` 設著，
  `clearImmediate` 並 flush 殘留 buffer，再清空 `writeBuffer`
- `fireWrite` 內 listener 呼叫包 `try/catch`（依現有模式）

### 4. `CLAUDE.md`

- 維護契約 (Invariants) 段落：把
  `@homebridge/node-pty-prebuilt-multiarch` is runtime dependency 改為
  `node-pty` is the runtime PTY binding；upstream ≥ 1.1 uses
  Microsoft's `portable-pty` Rust crate under the hood — do not
  reintroduce the homebridge fork.
- 外部 API 區段加上 `node-pty` 的 GitHub repo 連結

### 5. `test/ptyTerminalHost.coalescing.test.ts` (新增)

純函式測試 — `PtyTerminalHost` 沒有 `vscode` import，可直接使用既有
fake `PtyProcess` pattern。覆蓋：

| Case | 預期 |
| --- | --- |
| 同 tick 連發 10 chunks → listener 只 callback 1 次，內容為 joined 字串 | 必要 |
| Flush 後再 fireData → listener 收 2 次（各自獨立 joined） | 必要 |
| `close()` flush pending buffer：close 之前 fireData 不立即送達，close 後 spy 收到 1 次 joined | 必要 |
| Throwing listener 不影響後續 chunk coalescing | 必要 |
| `detectActivity` 對每個 chunk 觸發一次（共 100 chunks → 100 unseen events，但 markUnseen 仍 idempotent） | 確認行為不變 |
| 既有 `test/ptyTerminalHost.test.ts` "forwards data to write listeners" 用 fake timers 跑時仍通過 | 既有測試擴充選項 |

### 6. `docs/specs/2026-07-24-pty-data-pipeline-refresh.md` (事後 spec)

實作落地後，依 CLAUDE.md rule 從 `plans/` 移到 `docs/specs/`，格式
對齊 `2026-07-23-*.md`：

```
# PTY Data Pipeline Refresh

## 狀態

已實作。

## 範圍

- 依賴從 `@homebridge/node-pty-prebuilt-multiarch` 切換為 upstream `node-pty` ≥ 1.1
- `PtyTerminalFactory.onData` Set 與 fan-out 移除
- `PtyTerminalHost` 對 `vscode.Pseudoterminal.onDidWrite` 加入 `setImmediate` 邊界 chunk coalescing

## 行為

... (完成後再寫)
```

## 互動點

- **`plans/radiant-doodling-hammock.md`** (backpressure) 是 in-progress plan。
  本 plan 落地後：
  - 該 plan line 106-107 引用 `dataListeners` 變 stale；下次 backpressure
    實作時刪除那段 reference
  - 新增的 `bufferWrite` 與該 plan 的 `setImmediate` drain tick 共存，
    後者排在自己的 immediate callback，不同 `setImmediate` 各自獨立
- **`test/ptyTerminalHost.backpressure.test.ts`** 用 `vi.runAllTimers()`，
  會同時排空 coalescing 與 drain 兩個 timer —— 既有 7 case 預期不變

## Verification

| 步驟 | 指令 |
| --- | --- |
| 型別檢查 | `npx tsc --noEmit` |
| 三個 PTY 測試檔 | `npm test -- test/ptyTerminalHost.test.ts test/ptyTerminalHost.backpressure.test.ts test/ptyProcessContract.test.ts` 全綠 |
| 新增 coalescing 測試 | `npm test -- test/ptyTerminalHost.coalescing.test.ts` 全綠 |
| 完整測試 | `npm test` 全綠 |
| 完整 build | `npm run build` 產出 `superset-0.18.0.vsix` 並通過 `verify-vsix.sh` |
| VSIX 內容檢查 | `unzip -l superset-0.18.0.vsix \| grep node-pty` 確認 `node_modules/node-pty/build/Release/*.node` 與 `prebuilds/*` 皆被打包 |
| 手動驗證 | 開 PTY terminal 跑 `yes \| head -n 10000`，觀察 OutputChannel 無 backpressure PAUSE（4MB 未達），且 renderer 不卡頓 |
| 邊界 | 同 terminal 內連按 Enter 5 次（低頻），確認 prompt 顯示無可見延遲 |

## 後續可選 (非本次範圍)

- 動態 `setImmediate` 改為可注入 scheduler，便於測試更複雜的時序
- 將 `radiant-doodling-hammock.md` backpressure 與本 plan 的 bufferWrite
  寫成單一狀態機 class（`PtyDataPipeline`），目前兩者各佔一小段邏輯
- 若未來 `dataListeners` 復活需要，新介面應明確為 "raw chunks"，避免
  與 coalesced `onWrite` 混淆
