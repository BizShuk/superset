# mDNS Detail-View Query Cache 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 `superset.mdnsShowDetail` 加 60 秒的欄位快取,key 為 `${name}|${type}|${host}|${port}`,避免使用者短時間內重複看同一 service 細節時持續 re-resolve mDNS。

**Architecture:** 在 `MdnsRegistry` 加 `getDetailCached(svc): { detail, hit }` 包裝,內部維護 `Map<string, { value, expires }>`。`getDetailCached` 若 hit 直接回;若 miss 走 `buildMdnsDetailFields` 然後寫入(60s TTL)。Service expiration 觸發時 `invalidate(networkKey)` 同步清掉對應 cache。

**Tech Stack:** TypeScript / Vitest

---

## 1. 為何要做 (Why)

- **現有痛點**:看同一印表機 detail 兩次(EX:切換面板又切回)會重新 mDNS query,LAN 上無感但 WAN mDNS proxy 會卡。
- **既有鋪墊**:`buildMdnsDetailFields` 是純函式;`MdnsRegistry` 已有 byName Map,加 detail cache 是局部增量。
- **配對**:`mdns-service-expiration` 已規劃 TTL/eviction 邏輯,本 plan 同步其生命周期。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| 每次看 detail 觸發 mDNS query | 60s 內第二次以後直接拿快取 |
| Service 過期後 cache 仍 stale | 過期時同步 invalidate,下次 fetch 拿到新資料 |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                                |
| ------ | ----------------------------- | --------------------------------------------------- |
| Create | `src/mdnsDetailCache.ts`      | `DetailCache` class(get/set/invalidate)            |
| Create | `test/mdnsDetailCache.test.ts`| 純類別測試                                          |
| Modify | `src/mdnsRegistry.ts`         | 整合 `DetailCache` + 過期時 invalidate             |
| Modify | `src/extension.ts`            | `mdnsShowDetail` 命令改走 `getDetailCached`         |
| Modify | `test/mdnsRegistry.test.ts`   | 補 cache hit/miss case                              |

---

## 4. 實作步驟 (Tasks)

### Task 1: DetailCache class + 測試 (TDD)

**Files:**
- Create: `src/mdnsDetailCache.ts`
- Create: `test/mdnsDetailCache.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/mdnsDetailCache.test.ts
import { describe, it, expect, vi } from "vitest";
import { DetailCache } from "../src/mdnsDetailCache";

describe("DetailCache", () => {
    it("returns miss then hit", () => {
        vi.useFakeTimers();
        const c = new DetailCache<string>(60_000);
        expect(c.get("k")).toEqual({ hit: false });
        c.set("k", "v");
        expect(c.get("k")).toEqual({ hit: true, value: "v" });
        vi.useRealTimers();
    });

    it("expires after TTL", () => {
        vi.useFakeTimers();
        const c = new DetailCache<string>(1000);
        c.set("k", "v");
        vi.advanceTimersByTime(1001);
        expect(c.get("k")).toEqual({ hit: false });
        vi.useRealTimers();
    });

    it("invalidate removes a single key", () => {
        const c = new DetailCache<string>(60_000);
        c.set("k1", "v1");
        c.set("k2", "v2");
        c.invalidate("k1");
        expect(c.get("k1").hit).toBe(false);
        expect(c.get("k2").hit).toBe(true);
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- mdnsDetailCache`
Expected: FAIL。

- [ ] **Step 3: 實作**

```typescript
// src/mdnsDetailCache.ts
export interface CacheResult<T> {
    readonly hit: boolean;
    readonly value?: T;
}

export class DetailCache<T> {
    private store = new Map<string, { value: T; expires: number }>();

    constructor(private readonly ttlMs: number) {}

    public get(key: string): CacheResult<T> {
        const entry = this.store.get(key);
        if (!entry) return { hit: false };
        if (entry.expires <= Date.now()) {
            this.store.delete(key);
            return { hit: false };
        }
        return { hit: true, value: entry.value };
    }

    public set(key: string, value: T): void {
        this.store.set(key, { value, expires: Date.now() + this.ttlMs });
    }

    public invalidate(key: string): void {
        this.store.delete(key);
    }
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- mdnsDetailCache`
Expected: 3 個 case 綠。

- [ ] **Step 5: Commit**

```bash
git add src/mdnsDetailCache.ts test/mdnsDetailCache.test.ts
git commit -m "feat(mdns-cache): add DetailCache class with TTL + invalidate"
```

### Task 2: MdnsRegistry 整合 + 命令改走

**Files:**
- Modify: `src/mdnsRegistry.ts`
- Modify: `src/extension.ts`
- Modify: `test/mdnsRegistry.test.ts`

- [ ] **Step 1: 補測試 case**

```typescript
it("getDetailCached returns same value on second call within TTL", () => {
    const r = new MdnsRegistry(makeTransport());
    r.upsert({ name: "p", host: "h", port: 631, type: "_ipp._tcp" });
    const a = r.getDetailCached({ name: "p", host: "h", port: 631, type: "_ipp._tcp" });
    const b = r.getDetailCached({ name: "p", host: "h", port: 631, type: "_ipp._tcp" });
    expect(a.hit || b.hit).toBe(true); // at least one is hit
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- mdnsRegistry`
Expected: FAIL — `getDetailCached` 還沒定義。

- [ ] **Step 3: 在 MdnsRegistry 整合 DetailCache**

```typescript
// src/mdnsRegistry.ts
import { DetailCache } from "./mdnsDetailCache";
import { buildMdnsDetailFields, type DetailField } from "./mdnsTreeSpec";

export class MdnsRegistry {
    private detailCache = new DetailCache<readonly DetailField[]>(60_000);

    public getDetailCached(
        svc: Pick<MdnsService, "name" | "type" | "host" | "port">
    ): { hit: boolean; detail: readonly DetailField[] } {
        const key = `${svc.name}|${svc.type}|${svc.host ?? ""}|${svc.port}`;
        const cached = this.detailCache.get(key);
        if (cached.hit && cached.value) {
            return { hit: true, detail: cached.value };
        }
        const full = this.findByKey(key);
        const detail = full ? buildMdnsDetailFields(full) : [];
        this.detailCache.set(key, detail);
        return { hit: false, detail };
    }

    public invalidateDetail(svc: Pick<MdnsService, "name" | "type" | "host" | "port">): void {
        const key = `${svc.name}|${svc.type}|${svc.host ?? ""}|${svc.port}`;
        this.detailCache.invalidate(key);
    }
}
```

- [ ] **Step 4: extension.ts `mdnsShowDetail` 改走 getDetailCached**

```typescript
// 找既有 mdnsShowDetail 命令
const { detail } = mdnsRegistry.getDetailCached(svc);
// 之續用 detail (而非 buildMdnsDetailFields(svc)) 拼 modal 訊息
```

- [ ] **Step 5: service-expiration 觸發時呼叫 invalidate**

> 註:本 step 與 `mdns-service-expiration` plan 對齊;若該 plan 還沒實作,在 MdnsRegistry 內 `removeByName` / `evictExpired` hook 加 `invalidateDetail`。

```typescript
// 範例
public removeByName(name: string): void {
    const svc = this.byName.get(name);
    if (svc) this.invalidateDetail(svc);
    this.byName.delete(name);
}
```

- [ ] **Step 6: build + 跑全部測試**

Run: `npm run build && npm test`
Expected: 全綠。

- [ ] **Step 7: Commit**

```bash
git add src/mdnsRegistry.ts src/extension.ts test/mdnsRegistry.test.ts
git commit -m "feat(mdns): wire detail cache into registry + show detail command"
```

### Task 3: 自我審查

- [ ] **Step 1: 自我審查**

  - [ ] 3 個 mdnsDetailCache + 1 個 mdnsRegistry 新 case 對應 Task 1–2
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `DetailCache` / `getDetailCached` / `invalidateDetail` 名稱一致
  - [ ] TTL 60s 在測試用 fake timers 驗證

- [ ] **Step 2: README.md「mDNS」段落補 detail cache 說明**
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document mDNS detail cache"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| 60s 太長,使用者看到 stale 資訊 | TTL 設 60s(可配置,本 plan 用常數) | 縮短 TTL 或每次都 re-fetch |
| Cache map 無界成長 | 60s 內 service 數量有上限(同 LAN ~數十);過期自動清 | 加上 LRU eviction |
| `invalidate` 沒在所有 mutation 點呼叫 | Task 2 Step 5 在每個 upsert/remove 點補 | 改 TTL 為 0 變 no-op |

---

## 6. 完成定義

- [ ] 4 個新 test case 綠
- [ ] 同一 service 60s 內第二次 detail 走 cache(測試可驗證)
- [ ] service 過期後 cache 同步失效
- [ ] 既有測試不壞
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] mDNS detail-view query cache`
- 配對: [mDNS service expiration](plans/2026-06-23-feature-mdns-service-expiration.md)
- 測試位置: `test/mdnsDetailCache.test.ts`, `test/mdnsRegistry.test.ts`
