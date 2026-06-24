# mDNS Service Dedup 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `MdnsRegistry` 用 `host|port|type` 為 secondary key 去重,多網卡 / IPv4+IPv6 不再出現重複列。

**Architecture:** 在 `MdnsRegistry` 內,每筆 service 同時維護兩個 Map:`byName`(現有,給顯示用) + `byNetworkKey`(`${host}|${port}|${type}`)。每次 `upsert` 先看 byNetworkKey;若同 key 但 name 不同(同一主機兩個 mDNS 名稱),仍合併成同一 row,並把 aliases 存進 `service.aliases: string[]`。Tree spec 顯示時若 `aliases.length > 0`,在 tooltip 列出。

**Tech Stack:** TypeScript / Vitest

---

## 1. 為何要做 (Why)

- **現有痛點**:多網卡筆電(eth + wifi)同一個印表機會出現 2 列;`::1` 與 `127.0.0.1` 也會。
- **既有鋪墊**:`MdnsRegistry.upsert` 已有 byName Map,加 secondary index 是純增量。
- **小風險**:既有測試若有「以 name 為唯一識別」的假設會壞,需補 test fix。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| 同一印表機 2 列(eth + wifi) | 1 列 + 細節顯示 aliases 與 addresses 列表 |
| `MdnsService` 沒有 `aliases` 欄位 | 新增 readonly `aliases?: string[]`,IPC 不破壞舊介面 |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                              |
| ------ | ----------------------------- | ------------------------------------------------- |
| Modify | `src/mdnsRegistry.ts`         | 加 `byNetworkKey` Map;改 `upsert` 邏輯          |
| Modify | `src/types.ts`                | `MdnsService` 加 `aliases?: readonly string[]`   |
| Modify | `src/mdnsTreeSpec.ts`         | 細節顯示 aliases                                  |
| Modify | `test/mdnsRegistry.test.ts`   | 新 case:同 network key 不同 name 合併            |

---

## 4. 實作步驟 (Tasks)

### Task 1: 純函式:network key + 測試 (TDD)

**Files:**
- Create: `src/mdnsDedup.ts`(純函式)
- Create: `test/mdnsDedup.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/mdnsDedup.test.ts
import { describe, it, expect } from "vitest";
import { networkKey, mergeServices } from "../src/mdnsDedup";

describe("networkKey", () => {
    it("joins host/port/type with |", () => {
        expect(networkKey({ host: "h", port: 80, type: "_http._tcp" }))
            .toBe("h|80|_http._tcp");
    });
    it("uses first address when host missing", () => {
        expect(networkKey({ host: undefined, addresses: ["1.2.3.4"], port: 22, type: "_ssh._tcp" }))
            .toBe("1.2.3.4|22|_ssh._tcp");
    });
});

describe("mergeServices", () => {
    it("merges two services with same network key, keeping first name as canonical", () => {
        const a = { name: "printer", host: "p.local", port: 631, type: "_ipp._tcp" } as any;
        const b = { name: "printer-alt", host: "p.local", port: 631, type: "_ipp._tcp" } as any;
        const merged = mergeServices(a, b);
        expect(merged.name).toBe("printer");
        expect(merged.aliases).toEqual(["printer-alt"]);
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- mdnsDedup`
Expected: FAIL。

- [ ] **Step 3: 實作**

```typescript
// src/mdnsDedup.ts
import type { MdnsService } from "./types";

export function networkKey(s: Pick<MdnsService, "host" | "addresses" | "port" | "type">): string {
    const id = s.host ?? s.addresses[0] ?? "";
    return `${id}|${s.port}|${s.type}`;
}

export function mergeServices(a: MdnsService, b: MdnsService): MdnsService {
    const aliases = Array.from(new Set([...(a.aliases ?? []), a.name, b.name]))
        .filter((n) => n !== a.name);
    return {
        ...a,
        aliases,
        addresses: Array.from(new Set([...a.addresses, ...b.addresses])),
    };
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- mdnsDedup`
Expected: 3 個 case 綠。

- [ ] **Step 5: Commit**

```bash
git add src/mdnsDedup.ts test/mdnsDedup.test.ts
git commit -m "feat(mdns-dedup): add networkKey + mergeServices helpers"
```

### Task 2: MdnsRegistry 套用 secondary key

**Files:**
- Modify: `src/mdnsRegistry.ts`
- Modify: `src/types.ts`
- Modify: `test/mdnsRegistry.test.ts`

- [ ] **Step 1: types.ts 加 aliases 欄位**

```typescript
// src/types.ts
export interface MdnsService {
    /* existing fields */
    readonly aliases?: readonly string[];
}
```

- [ ] **Step 2: registry 加 byNetworkKey Map**

```typescript
private byNetworkKey = new Map<string, MdnsService>();

private upsertInternal(svc: MdnsService) {
    const key = networkKey(svc);
    const existing = this.byNetworkKey.get(key);
    const merged = existing ? mergeServices(existing, svc) : svc;
    this.byNetworkKey.set(key, merged);
    this.byName.set(merged.name, merged); // ensure canonical name stays
    return merged;
}
```

並把現有 `upsert` 改呼叫 `upsertInternal`。

- [ ] **Step 3: 補測試 case**

```typescript
it("dedupes by network key when two names share host|port|type", () => {
    const r = new MdnsRegistry(makeTransport());
    r.upsert({ name: "p", host: "h", port: 631, type: "_ipp._tcp" });
    r.upsert({ name: "p-alt", host: "h", port: 631, type: "_ipp._tcp" });
    expect(r.getAll().length).toBe(1);
    expect(r.getAll()[0].aliases).toContain("p-alt");
});
```

- [ ] **Step 4: 跑既有 + 新測試**

Run: `npm test -- mdnsRegistry`
Expected: 既有 + 新 1 case 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/mdnsRegistry.ts src/types.ts test/mdnsRegistry.test.ts
git commit -m "feat(mdns): dedupe by network identity, expose aliases"
```

### Task 3: tree spec 顯示 aliases

**Files:**
- Modify: `src/mdnsTreeSpec.ts`

- [ ] **Step 1: 在 detail fields 內 aliases 顯示**

在 `buildMdnsDetailFields` 內:

```typescript
if (svc.aliases && svc.aliases.length > 0) {
    fields.push({ label: "Aliases", value: svc.aliases.join(", ") });
}
```

- [ ] **Step 2: 跑既有 mdnsTreeSpec 測試**

Run: `npm test -- mdnsTreeSpec`
Expected: 既有測試不壞(若無對 aliases 的 case,本 plan 補一個)。

- [ ] **Step 3: Commit**

```bash
git add src/mdnsTreeSpec.ts
git commit -m "feat(mdns-ui): show aliases in service detail"
```

### Task 4: 自我審查

- [ ] **Step 1: 自我審查**

  - [ ] 3 個 mdnsDedup + 1 個 mdnsRegistry 新 case 對應 Task 1–2
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `networkKey` / `mergeServices` / `byNetworkKey` 名稱一致
  - [ ] 既有測試不壞

- [ ] **Step 2: README.md「mDNS」段落補 aliases 說明**
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document mDNS aliases display"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| 既有 test 假設 name 唯一而失敗 | Task 2 Step 3 補新 case;既有 case 預期少數需要更新 expected | 移除 `byNetworkKey` 邏輯,退回 byName only |
| 合併後 name 變了用戶感覺「消失」 | canonical name 採 first-seen;toast 提示用戶 | 改成保留兩個 row,只 dedup「addresses」 |
| `aliases` 破壞 IPC 介面 | `readonly` optional 加,向後相容 | 不加 aliases 欄位,改用 `Map<key, MdnsService[]>` 內部存 |

---

## 6. 完成定義

- [ ] 4 個新 test case 綠
- [ ] 同 host|port|type 多 name 合併成 1 row
- [ ] detail view 顯示 aliases
- [ ] 既有測試不壞
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] mDNS service dedup`
- 配對: [mDNS service expiration](plans/2026-06-23-feature-mdns-service-expiration.md)
- 測試位置: `test/mdnsDedup.test.ts`, `test/mdnsRegistry.test.ts`
