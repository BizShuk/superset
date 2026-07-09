# Group Metadata Persistence 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 `GroupStore` 的 `cwd` / `gitRemote` 對應表持久化到 `context.workspaceState`,使 workspace-aware group 建議在 VSCode 重啟後仍生效。

**Architecture:** 在 `GroupStore` 內部加 `load()` / `save()` 方法,序列化 metas Map 為 `Record<string, {cwd?, gitRemote?}>` 存到 `workspaceState.get('superset.groupMetas')`。`setGroupMeta` 觸發 debounced save(200ms)。Activate 時呼叫 `load()`。

**Tech Stack:** TypeScript / Vitest / `context.workspaceState` (stable)

---

## 1. 為何要做 (Why)

- **現有痛點**:目前 `metas` 是 in-memory Map,重啟後歸零,自動分組建議失效。
- **既有鋪墊**:I1 `workspace-aware-group-suggestions` plan 已加 `setGroupMeta` 介面;本 plan 只加 persistence layer。
- **小風險**:JSON 序列化需處理 Map 結構;debounce 避免寫入抖動。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| 重啟後自動分組建議失效 | 重啟後 metas 還原,既有 group 持續被自動偵測 |
| 沒看到 metas 從哪來 | 既有 `groupStore.setGroupMeta` 呼叫點(在 extension.ts)自動觸發保存 |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                                  |
| ------ | ----------------------------- | ----------------------------------------------------- |
| Create | `src/groupStorePersist.ts`    | 純函式 `serialize`, `deserialize`                      |
| Create | `test/groupStorePersist.test.ts` | 純函式單元測試                                      |
| Modify | `src/groupStore.ts`           | 加 `load()`, `save()` + debounced write              |
| Modify | `test/groupStore.test.ts`     | 補 round-trip test                                    |
| Modify | `src/extension.ts`            | activate 內呼叫 `groupStore.load()`                   |

---

## 4. 實作步驟 (Tasks)

### Task 1: 純函式序列化 + 測試 (TDD)

**Files:**
- Create: `src/groupStorePersist.ts`
- Create: `test/groupStorePersist.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/groupStorePersist.test.ts
import { describe, it, expect } from "vitest";
import { serializeMetas, deserializeMetas } from "../src/groupStorePersist";

describe("serializeMetas / deserializeMetas", () => {
    it("round-trips cwd + gitRemote", () => {
        const meta = { cwd: "/x", gitRemote: "gh.com/foo/bar" };
        const out = deserializeMetas(serializeMetas({ g1: meta }));
        expect(out).toEqual({ g1: meta });
    });

    it("survives partial meta (only cwd)", () => {
        const out = deserializeMetas(serializeMetas({ g1: { cwd: "/x" } }));
        expect(out).toEqual({ g1: { cwd: "/x" } });
    });

    it("returns empty object on invalid JSON", () => {
        expect(deserializeMetas("not-json")).toEqual({});
    });

    it("returns empty object on non-object JSON", () => {
        expect(deserializeMetas("[]")).toEqual({});
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- groupStorePersist`
Expected: FAIL。

- [ ] **Step 3: 實作**

```typescript
// src/groupStorePersist.ts
export interface GroupMeta {
    readonly cwd?: string;
    readonly gitRemote?: string;
}

export type SerializedMetas = Record<string, GroupMeta>;

export function serializeMetas(metas: SerializedMetas): string {
    return JSON.stringify(metas);
}

export function deserializeMetas(raw: string | undefined): SerializedMetas {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return {};
        }
        return parsed as SerializedMetas;
    } catch {
        return {};
    }
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- groupStorePersist`
Expected: 4 個 case 綠。

- [ ] **Step 5: Commit**

```bash
git add src/groupStorePersist.ts test/groupStorePersist.test.ts
git commit -m "feat(group-persist): add serialize/deserialize helpers"
```

### Task 2: GroupStore load/save + debounce

**Files:**
- Modify: `src/groupStore.ts`
- Modify: `test/groupStore.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/groupStore.test.ts (append)
it("persists metas to workspaceState", () => {
    const writes: Array<[string, unknown]> = [];
    const ws = {
        get: (k: string) => undefined,
        update: (k: string, v: unknown) => { writes.push([k, v]); return Promise.resolve(); },
    } as any;
    const store = new GroupStore();
    store.attachPersistence(ws);
    const g = store.createGroup("frontend");
    store.setGroupMeta(g.id, { cwd: "/x" });
    return new Promise((r) => setTimeout(r, 250)).then(() => {
        expect(writes[0][0]).toBe("superset.groupMetas");
        expect(JSON.parse(writes[0][1] as string)).toEqual({ [g.id]: { cwd: "/x" } });
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- groupStore`
Expected: FAIL — `attachPersistence` 還沒定義。

- [ ] **Step 3: GroupStore 加 persistence hooks**

```typescript
// src/groupStore.ts
import { serializeMetas, deserializeMetas, type GroupMeta } from "./groupStorePersist";
import type * as vscode from "vscode";

export class GroupStore {
    private workspaceState: vscode.MimeWorkspaceState | undefined;
    private saveTimer: NodeJS.Timeout | undefined;

    public attachPersistence(state: vscode.MimeWorkspaceState): void {
        this.workspaceState = state;
        const raw = state.get<string>("superset.groupMetas");
        const saved = deserializeMetas(raw);
        for (const [id, m] of Object.entries(saved)) {
            this.metas.set(id, m);
        }
    }

    public setGroupMeta(id: string, meta: GroupMeta): void {
        this.metas.set(id, { ...this.metas.get(id), ...meta });
        this.scheduleSave();
    }

    private scheduleSave(): void {
        if (!this.workspaceState) return;
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flushSave(), 200);
    }

    private async flushSave(): Promise<void> {
        if (!this.workspaceState) return;
        const snapshot: Record<string, GroupMeta> = {};
        for (const [k, v] of this.metas) snapshot[k] = v;
        await this.workspaceState.update("superset.groupMetas", serializeMetas(snapshot));
    }
}
```

> 註:`vscode.MimeWorkspaceState` 為示意,實作上用 `vscode.ExtensionContext["workspaceState"]` 直接注入型別即可。

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- groupStore`
Expected: 既有 + 新 1 case 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/groupStore.ts test/groupStore.test.ts
git commit -m "feat(group-store): persist metas to workspaceState with debounce"
```

### Task 3: extension.ts 啟動時 load

**Files:**
- Modify: `src/extension.ts:34-83`

- [ ] **Step 1: 啟動時呼叫 attachPersistence**

```typescript
const groupStore = new GroupStore();
groupStore.attachPersistence(context.workspaceState);
```

- [ ] **Step 2: build + 跑測試**

Run: `npm run build && npm test`
Expected: 全綠。

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat(extension): load group metas on activate"
```

### Task 4: 自我審查

- [ ] **Step 1: 自我審查**

  - [ ] 4 個 groupStorePersist + 1 個 groupStore 新 case 對應 Task 1–2
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `serializeMetas` / `deserializeMetas` / `attachPersistence` 名稱一致
  - [ ] debounce 200ms 在 test 用 `setTimeout(250)` 容納

- [ ] **Step 2: README.md「Groups」段落加 persistence 說明**
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document group metas persistence"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| 寫入太頻繁 | 200ms debounce,測試已驗證 | 改成同步寫入 |
| JSON 大型 metas 撐爆 workspaceState | 1 workspace 內 metas 上限 ≈ 數十個 group,可忽略 | 改用 globalState 分散 |
| 舊格式 migration | 第一版直接讀舊 metas;若格式變更,加 `version` 欄位 | 不適用 |

---

## 6. 完成定義

- [ ] 5 個新 test case 綠
- [ ] `setGroupMeta` 後 200ms 內 `workspaceState.update` 被呼叫
- [ ] activate 時 `attachPersistence` 還原 metas
- [ ] 既有測試不壞
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] Group metadata persistence`
- 上游: [workspace-aware group suggestions](plans/2026-06-23-feature-workspace-aware-group-suggestions.md)
- 測試位置: `test/groupStorePersist.test.ts`, `test/groupStore.test.ts`
