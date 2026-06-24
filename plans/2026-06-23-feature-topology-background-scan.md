# Topology Background Scan 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 啟用後,`TopologyStore` 週期性呼叫 `NodeTopologyScanner.scan()`,間隔可由設定調整,掃描期間 status bar 顯示進度。

**Architecture:** 在 `TopologyStore.start()` 內用 `setInterval` 啟動背景掃描;間隔讀自 `vscode.workspace.getConfiguration("superset").get("topologyScanIntervalMinutes", 5)`。新增 `isScanning` flag + `onDidChange` 事件,讓 UI 訂閱並在 status bar 顯示「Topology: scanning...」icon。`deactivate` / `stop()` 時 `clearInterval`。

**Tech Stack:** TypeScript / Vitest / `vscode.workspace.getConfiguration` / `vscode.StatusBarItem`

---

## 1. 為何要做 (Why)

- **現有痛點**:`superset.topologyScan` 是手動命令,網路拓撲變化(印表機離線、新 IoT 裝置加入)不會主動更新。
- **既有鋪墊**:`NodeTopologyScanner.scan()` 已穩定(`test/topologyStore.test.ts` 1 case 涵蓋),`TopologyStore` 已有 `start()` / `stop()` / `scan()` 對外契約。
- **低成本**:`setInterval` + configuration read 是 30 行內可完成。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| 拓撲列表只在手動按 `Scan` 時更新 | 每 5 分鐘自動掃描(可在 settings 改) |
| 掃描期間沒有視覺回饋 | Status bar 顯示 `$(radio-tower) scanning...` icon,完成後隱藏 |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                                  |
| ------ | ----------------------------- | ----------------------------------------------------- |
| Modify | `src/topologyStore.ts`        | 加 `intervalTimer` / `isScanning` / `setInterval` 邏輯 |
| Modify | `test/topologyStore.test.ts`  | 假時間(fake timers)測 start/stop 週期                |
| Modify | `src/extension.ts`            | status bar 訂閱 `isScanning` 變化                     |
| Modify | `package.json`                | 加 `superset.topologyScanIntervalMinutes` 設定       |

---

## 4. 實作步驟 (Tasks)

### Task 1: TopologyStore 週期掃描 (TDD)

**Files:**
- Modify: `src/topologyStore.ts`
- Modify: `test/topologyStore.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/topologyStore.test.ts (append)
import { vi } from "vitest";

it("start() schedules periodic scan at given interval", async () => {
    vi.useFakeTimers();
    const scanner = { scan: vi.fn().mockResolvedValue(undefined) } as any;
    const store = new TopologyStore(scanner);
    store.start({ intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(3500);
    expect(scanner.scan).toHaveBeenCalledTimes(3);
    store.stop();
    vi.useRealTimers();
});

it("stop() clears the interval", async () => {
    vi.useFakeTimers();
    const scanner = { scan: vi.fn().mockResolvedValue(undefined) } as any;
    const store = new TopologyStore(scanner);
    store.start({ intervalMs: 1000 });
    store.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(scanner.scan).not.toHaveBeenCalled();
    vi.useRealTimers();
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- topologyStore`
Expected: FAIL — `start` 不接受 options。

- [ ] **Step 3: 修改 TopologyStore**

```typescript
// src/topologyStore.ts
export interface TopologyStoreOptions {
    readonly intervalMs?: number; // 0 = disabled
}

export class TopologyStore {
    private timer: NodeJS.Timeout | undefined;
    private intervalMs = 0;
    private _isScanning = false;

    public get isScanning(): boolean {
        return this._isScanning;
    }

    public start(options: TopologyStoreOptions = {}): void {
        this.stop();
        this.intervalMs = options.intervalMs ?? 0;
        if (this.intervalMs <= 0) return;
        this.timer = setInterval(() => void this.tick(), this.intervalMs);
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    private async tick(): Promise<void> {
        this._isScanning = true;
        try {
            await this.scan();
        } finally {
            this._isScanning = false;
        }
    }
}
```

> 註:既有 `scan()` 方法保留不動,只外包 `tick()` 處理 isScanning flag。

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- topologyStore`
Expected: 既有 1 + 新 2 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/topologyStore.ts test/topologyStore.test.ts
git commit -m "feat(topology): periodic background scan with isScanning flag"
```

### Task 2: extension.ts 接 status bar + configuration

**Files:**
- Modify: `src/extension.ts:206-218`(topology view 區)
- Modify: `package.json`(contributes.configuration)

- [ ] **Step 1: extension.ts 啟動時讀設定**

```typescript
const intervalMinutes = vscode.workspace
    .getConfiguration("superset")
    .get<number>("topologyScanIntervalMinutes", 5);
topologyStore.start({ intervalMs: intervalMinutes * 60 * 1000 });

// status bar indicator
const scanIndicator = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50
);
scanIndicator.text = "$(radio-tower) Scanning topology…";
const updateIndicator = () => {
    if (topologyStore.isScanning) {
        scanIndicator.show();
    } else {
        scanIndicator.hide();
    }
};
// poll every 250ms while active; in MVP use a setInterval that's
// cleared on dispose. Polling is cheap (just a bool read).
const pollHandle = setInterval(updateIndicator, 250);
subscriptions.push({
    dispose: () => {
        clearInterval(pollHandle);
        scanIndicator.dispose();
    },
});
```

- [ ] **Step 2: package.json 加 configuration**

```json
"configuration": {
    "title": "Superset",
    "properties": {
        "superset.topologyScanIntervalMinutes": {
            "type": "number",
            "default": 5,
            "minimum": 0,
            "description": "拓撲背景掃描間隔(分鐘);0 = 停用"
        }
    }
}
```

- [ ] **Step 3: 跑全部測試 + build**

Run: `npm run build && npm test`
Expected: 全綠。

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat(topology): wire periodic scan to settings + status bar"
```

### Task 3: 自我審查

- [ ] **Step 1: 自我審查**

  - [ ] 2 個 topologyStore test case 對應 Task 1
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `intervalMs` / `isScanning` / `tick` 名稱一致
  - [ ] `setInterval` 在 `stop()` / `dispose` 都清掉,無 leak

- [ ] **Step 2: README.md「Topology」段落補背景掃描說明**
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document background topology scan setting"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| 掃描太頻繁打爆網路 | 預設 5 分鐘 + setting 允許 0 停用 | 改 `default: 0` 或刪 `setInterval` |
| 多個 VSCode window 同時掃描 | 每個 window 各自有 process,本來就會重複 | 不處理(本機行為) |
| 掃描卡住導致 status bar 一直顯示 | `tick` 內 `try/finally` 確保 flag 歸位;`scan()` 已有 timeout | 在 `tick` 加 `setTimeout` 強制歸位 |

---

## 6. 完成定義

- [ ] 2 個 topologyStore 新 case 綠
- [ ] 啟用後每 5 分鐘自動掃描,status bar 在掃描期間顯示
- [ ] setting `superset.topologyScanIntervalMinutes = 0` 停用
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] Topology background scan`
- 既有模組: `src/topologyStore.ts:start/stop/scan`, `src/extension.ts`
- 測試位置: `test/topologyStore.test.ts`
