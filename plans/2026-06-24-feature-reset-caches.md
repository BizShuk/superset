# Reset All Caches 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 註冊 `superset.resetCaches` 命令,一鍵清空 `context.workspaceState` 所有 `superset.*` key + 觸發各 store 重新載入(重啟 mDNS listener、topology 掃描、TODO 重新讀檔)。

**Architecture:** 在 `extension.ts` 內建一個 `resetCaches()` 函式,呼叫 `context.workspaceState.keys()` 篩掉 VSCode 內部 key,呼叫各 store 提供的 `reset()` 方法(若無,加一個 no-op stub)。命令本身走 `vscode.window.showWarningMessage` 二次確認,避免誤觸。

**Tech Stack:** TypeScript / Vitest

---

## 1. 為何要做 (Why)

- **現有痛點**:開發/測試期間,各 store 的 in-memory state 一旦髒掉沒有自我服務的清空路徑(只能 reload window,太重)。
- **既有鋪墊**:`context.workspaceState.keys()` 是 stable API,各 store 都有 `start()` 重啟入口。
- **低成本**:15 行 reset 函式 + 1 個命令 + 3 個 store stub。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| Cache 髒掉需 reload window(慢) | 單一命令 `Superset: Reset Caches` 即可,且有二次確認 |
| 各 store 沒有 reset 介面 | 加上 `reset()` stub,本 plan 不改 store 行為,只補介面 |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                                |
| ------ | ----------------------------- | --------------------------------------------------- |
| Create | `src/resetCaches.ts`          | 純函式 `collectSupersetKeys(workspaceState): string[]` |
| Create | `test/resetCaches.test.ts`    | 純函式測試                                          |
| Modify | `src/topologyStore.ts`        | 加 `reset(): void` no-op stub                      |
| Modify | `src/todoStore.ts`            | 加 `reset(): void` 重新讀檔                         |
| Modify | `src/mdnsRegistry.ts`         | 加 `reset(): void` restart transport                |
| Modify | `src/extension.ts`            | 註冊命令 + 二次確認 + 呼叫各 reset                  |
| Modify | `package.json`                | 加 command                                          |

---

## 4. 實作步驟 (Tasks)

### Task 1: 純函式 + 測試 (TDD)

**Files:**
- Create: `src/resetCaches.ts`
- Create: `test/resetCaches.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/resetCaches.test.ts
import { describe, it, expect } from "vitest";
import { collectSupersetKeys } from "../src/resetCaches";

describe("collectSupersetKeys", () => {
    it("returns only keys starting with 'superset.'", () => {
        const state = {
            keys: () => [
                "superset.auditLevel",
                "superset.panelLayout",
                "workbench.panel.defaultLocation",
                "typescript.tsdk",
            ],
        } as any;
        expect(collectSupersetKeys(state)).toEqual([
            "superset.auditLevel",
            "superset.panelLayout",
        ]);
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- resetCaches`
Expected: FAIL — 還沒定義。

- [ ] **Step 3: 實作**

```typescript
// src/resetCaches.ts
export interface KeyedState {
    keys(): readonly string[];
}

export function collectSupersetKeys(state: KeyedState): readonly string[] {
    return state.keys().filter((k) => k.startsWith("superset."));
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- resetCaches`
Expected: 1 個 case 綠。

- [ ] **Step 5: Commit**

```bash
git add src/resetCaches.ts test/resetCaches.test.ts
git commit -m "feat(reset): add collectSupersetKeys pure helper"
```

### Task 2: 各 store 加 reset() stub

**Files:**
- Modify: `src/topologyStore.ts`
- Modify: `src/todoStore.ts`
- Modify: `src/mdnsRegistry.ts`

- [ ] **Step 1: topologyStore.reset()** — 重新跑一次 scan + 清掉 timer

```typescript
public reset(): void {
    this.stop();           // clear existing interval
    this.intervalMs = 0;   // pause until start() is called again
    this._isScanning = false;
}
```

- [ ] **Step 2: todoStore.reset()** — 重新讀檔

```typescript
public reset(): Promise<void> {
    return this.load();
}
```

- [ ] **Step 3: mdnsRegistry.reset()** — restart transport

```typescript
public reset(): void {
    this.stop();
    this.start();
}
```

- [ ] **Step 4: 跑既有測試確認沒壞**

Run: `npm test`
Expected: 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/topologyStore.ts src/todoStore.ts src/mdnsRegistry.ts
git commit -m "feat(stores): add reset() stubs for cache wipe"
```

### Task 3: 註冊命令 + 二次確認

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: extension.ts resetCaches 函式**

```typescript
async function resetCaches() {
    const choice = await vscode.window.showWarningMessage(
        "Superset: 確認重置所有快取?",
        { modal: true },
        "Reset"
    );
    if (choice !== "Reset") return;
    for (const key of collectSupersetKeys(context.workspaceState)) {
        await context.workspaceState.update(key, undefined);
    }
    topologyStore.reset();
    await todoStore.reset();
    mdnsRegistry.reset();
    vscode.window.showInformationMessage("Superset: 快取已重置");
}

subscriptions.push(
    vscode.commands.registerCommand("superset.resetCaches", resetCaches)
);
```

- [ ] **Step 2: package.json 加 command**

```json
{
    "command": "superset.resetCaches",
    "title": "Superset: Reset Caches",
    "icon": "$(debug-restart)"
}
```

- [ ] **Step 3: build + 跑測試**

Run: `npm run build && npm test`
Expected: 全綠。

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat(ui): wire Superset: Reset Caches command"
```

### Task 4: 自我審查

- [ ] **Step 1: 自我審查**

  - [ ] 1 個 resetCaches test case 對應 Task 1
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `collectSupersetKeys` / `reset()` / `superset.resetCaches` 名稱一致
  - [ ] `context.workspaceState.update(key, undefined)` 確認會真的刪除 key(查 VSCode API)

- [ ] **Step 2: README.md 加 reset 命令說明**
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Superset: Reset Caches"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| 誤觸把設定/panel layout 都清掉 | 二次確認 modal | 移除命令註冊 |
| `context.workspaceState.update(key, undefined)` 在某些版本不刪 key | 查 VSCode API;若無效,改用 `context.workspaceState` 提供 `keys().forEach(k => ...)` 加 `for` loop + try/catch | 不適用 |
| 各 store 的 `reset()` 實作不完整導致半毀 | Task 2 stub 簡單,失敗也只影響單一 store | 各 store 加 try/catch 隔離 |

---

## 6. 完成定義

- [ ] 1 個 `resetCaches` test case 綠
- [ ] 3 個 store 都有 `reset()` 介面
- [ ] 執行命令會清空 workspaceState + 觸發 3 個 store reset
- [ ] 既有測試不壞
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] Superset: Reset All Caches`
- 既有模組: 3 個 store 各自的 `start/stop`
- 測試位置: `test/resetCaches.test.ts`
