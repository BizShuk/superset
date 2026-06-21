# Plan: Add `window.onDidWriteTerminalData` (deprecated fallback) for TUI detection

## Context

`superset` 現有 watcher 只訂閱 `vscode.window.onDidStartTerminalShellExecution` + `execution.read()`,這條路徑對 line-buffered shell script 工作正常,但對 **TUI app** (`claude`、`vim`、`htop`...) 漏資料。原因:

- TUI 是一次長跑 shell command(只有一次 `onDidStartShellExecution`)
- TUI 內部 redraw 大量使用 ANSI escape (`\x1b[2J` 清屏、`\x1b[H` 游標回左上)
- shell integration 對 TUI 風格的 raw PTY 串流解析不可靠,`execution.read()` 經常漏 chunk

要解這個問題,需要繞過 shell integration 這層抽象,直接訂閱 **每一個 byte 寫入 PTY** 的事件。

## 為什麼選 A (`window.onDidWriteTerminalData`) 而非 B (`Terminal.onDidWriteData`)

| 面向 | A (本計畫採用) | B |
|---|---|---|
| API 狀態 | Deprecated 但 1.85+ 仍可用 | Proposed,需 `enabledApiProposals` |
| `package.json` 變更 | 無 | 加 `enabledApiProposals: ["terminalWriteData"]` |
| 型別 shim | 無 | 需本地 `.d.ts` |
| 市集審查 | 友善 | 需 proposed 審核 |
| 訂閱層級 | Window 全域,callback 內 filter | Per-terminal,語意乾淨 |
| Lifecycle | 一次性訂閱,自行管 | 跟 registry added/removed 對齊 |

短期 A 最穩;deprecation 警告若日後被拔,可無痛升級到 B(計畫保留對照細節在 `superset/CLAUDE.md`)。

**新 watcher 與現有 OutputWatcher 並存**:
- Shell integration 路徑保留,處理一般 shell script 與命令 exit code 相關診斷
- 新 raw write 路徑補 TUI 缺口
- `registry.markUnseen` 本身 idempotent(`terminalRegistry.ts:35-42`),雙重觸發無副作用

## 變更範圍

### 1. `src/rawOutputWatcher.ts` (新) — 新元件

模式對齊現有 `outputWatcher.ts` 的依賴注入風格,確保可在 Vitest 跑、不污染 `vscode`:

```typescript
import type { TerminalHandle } from "./types";
import type { TerminalRegistry } from "./terminalRegistry";

/**
 * Per-write event from `window.onDidWriteTerminalData`. We model it
 * structurally instead of importing `vscode.Terminal` so tests can fake
 * it without pulling in the vscode module.
 */
export interface TerminalWriteEvent {
    terminal: TerminalHandle;
    data: string;
}

export interface RawOutputWatcherDeps {
    registry: TerminalRegistry;
    getActiveTerminal: () => TerminalHandle | undefined;
    /**
     * 給 extension.ts 組裝層實作,把 callback 接到
     * `vscode.window.onDidWriteTerminalData`,回傳 dispose function。
     * 測試中可注入 fake subscribeAllWrites。
     */
    subscribeAllWrites: (
        cb: (event: TerminalWriteEvent) => void
    ) => () => void;
    /**
     * Optional diagnostic sink. Receives one human-readable line per
     * meaningful decision the watcher makes, mirroring OutputWatcher.
     */
    log?: (msg: string) => void;
}

export class RawOutputWatcher {
    private dispose?: () => void;

    constructor(private readonly deps: RawOutputWatcherDeps) {}

    start(): void {
        if (this.dispose) return;
        const log = this.deps.log;
        this.dispose = this.deps.subscribeAllWrites((event) => {
            const { terminal, data } = event;
            // 不在 registry 裡的 terminal 直接跳過(pre-populate 之前的 race)
            if (!this.deps.registry.has(terminal)) {
                log?.(`[raw] skip "${terminal.name}": not in registry`);
                return;
            }
            // active terminal 不高亮(避免自我觸發)
            const active = this.deps.getActiveTerminal();
            if (active === terminal) {
                return;
            }
            log?.(
                `[raw] markUnseen("${terminal.name}") ` +
                    `bytes=${data.length} active="${active?.name ?? "<none>"}"`
            );
            this.deps.registry.markUnseen(terminal);
        });
    }

    stop(): void {
        this.dispose?.();
        this.dispose = undefined;
    }
}
```

**設計重點**:
- 用依賴注入而非直接呼叫 `vscode.window.onDidWriteTerminalData`,保持單元可測
- callback 內一次做完所有 filter:registry 內 + 非 active → markUnseen
- `markUnseen` idempotent 處理重複觸發(高頻 TUI redraw 安全)

### 2. `src/extension.ts` — 組裝新元件

在現有 `OutputWatcher` 組裝段(行 86-129)後新增:

```typescript
// RawOutputWatcher: window.onDidWriteTerminalData(deprecated),
// 補 OutputWatcher 在 TUI 場景漏 chunk 的缺口。
const rawWatcher = new RawOutputWatcher({
    registry,
    getActiveTerminal: () => vscode.window.activeTerminal,
    log,
    subscribeAllWrites: (cb) => {
        // `onDidWriteTerminalData` 在 1.85+ 仍可用(deprecated)。
        // 參數型別在 @types/vscode 為 TerminalDataWriteEvent,
        // 我們只取 terminal + data 兩個欄位。
        const disposable = vscode.window.onDidWriteTerminalData((e) => {
            cb({ terminal: e.terminal, data: e.data });
        });
        return () => disposable.dispose();
    },
});
rawWatcher.start();
log("RawOutputWatcher started");
subscriptions.push({ dispose: () => rawWatcher.stop() });
```

> 兩個 watcher 並存:`OutputWatcher` 走 shell integration,`RawOutputWatcher` 走 raw PTY;`markUnseen` idempotent 處理重複事件。
>
> 型別:`@types/vscode@1.85.0` 對 `onDidWriteTerminalData` 提供完整型別(尚未移除),不需本地 shim。

### 3. `test/rawOutputWatcher.test.ts` (新) — 單元測試

對齊 `test/outputWatcher.test.ts` 的風格,覆蓋:

| Case | 驗證點 |
|---|---|
| `subscribes to writes on start()` | `subscribeAllWrites` 呼叫一次 |
| `marks non-active terminal unseen on data` | callback 觸發時 `markUnseen` 被呼叫 |
| `does NOT mark active terminal unseen` | active 終端機的寫入被忽略 |
| `ignores data from terminal not in registry` | 未註冊 terminal 不拋錯、不標 unseen |
| `stop() unsubscribes from writes` | `stop()` 後 callback 不再被呼叫 |
| `handles high-frequency writes idempotently` | 連續 100 次寫入只 emit 1 次 unseen 事件(靠 registry idempotency) |

用既有 `fakeTerminal` 工具函式 + 自己寫的 `fakeSubscribeAllWrites`(儲存 cb + dispose 計數器)。

### 4. `superset/CLAUDE.md` (新) — 專案說明 + TUI 偵測方案對照

新增專案層級 CLAUDE.md,內容包括:
- 專案目的與建置指令(從 README 濃縮)
- TUI 偵測方案對照表(A/B/C 三方案、為何選 A、未來升級路徑)
- 與 vscode-plugin-experiment 根 `CLAUDE.md` 的對應(子模組結構說明)

## 為什麼不改 `TerminalHandle` 介面

`TerminalHandle`(`src/types.ts:1-6`)目前只有 `name` / `show` / `dispose`,刻意保持結構精簡。`onDidWriteTerminalData` 是 window 層級 event,本來就不需要 Terminal 物件的新方法,介面零侵入。

## 驗證

1. **Type check**:`npx tsc --noEmit` 需乾淨通過
2. **Unit tests**:`npm test` 預期 35+ 個 case 通過(原 29 + 新 6)
3. **Build**:`npm run build` 產生 `out/extension.js`
4. **Dev 試跑**:
    - `F5` 開 Extension Development Host
    - 開一個 terminal 跑 `claude`(TUI 場景)
    - 切到另一個 terminal 等 Claude Code 輸出
    - 確認面板、tab 名稱、狀態列三處同步高亮
    - 切回 Claude terminal 確認高亮清除
5. **對照組**:同樣的 `claude` 場景下,先前版本完全沒高亮;裝上 raw watcher 後應可見
6. **打包**:`npx @vscode/vsce package` 確認無 `enabledApiProposals` 也能成功

## 風險與注意

- **Deprecation**:`onDidWriteTerminalData` 雖仍可用,但 VSCode 未來若拔,需改寫成 B 方案(per-terminal `onDidWriteData`)
- **PTY 事件量**:TUI 高頻 redraw 時,callback 觸發頻率可能很高(每秒數十~數百次)。靠 `markUnseen` 的 idempotent 早退機制,實際 emit 頻率仍維持「每 terminal 最多 N 次 unseen 切換」,效能影響可忽略
- **Callback 內 terminal 比對**:每個寫入事件都要 `registry.has(terminal)` + `getActiveTerminal()` 比對,O(1) 但量大時仍佔 CPU。可接受,未來若真有瓶頸再加 LRU 快取
