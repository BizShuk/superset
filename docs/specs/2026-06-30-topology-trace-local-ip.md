# Topology Trace 本機 IP 補齊 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Topology 面板的 trace 路徑顯示本機自身 IP(預設列在 hop 0),從 `listInterfaces()` + `getDefaultGateway()` 推導而來,不依賴 `traceroute` 指令輸出。

**Architecture:** 新增純函式 `deriveLocalIp(interfaces, gateway)` 決定本機 IPv4;`TopologyStore.scan()` 拿到 interfaces + gateway 後呼叫它,若回傳非 null 且 trace 非空,把本機 IP 以 `role: "local"` 標記 prepend 到 `hops`。store 在 render 時把 `role === "local"` 的 hop 顯示成 description `本機` 而不是 time。

**Tech Stack:** TypeScript / Vitest / 無新 dependency

---

## 1. 為何要做 (Why)

- **現有痛點**:`traceroute` 從 default gateway 起算,**本機 IP 不會出現在 trace 路徑**。面板看起來像「無頭路徑」— 用戶不知道 trace 起點是哪台機器。
- **資料已備齊**:`scan()` 已並行呼叫 `listInterfaces()` + `getDefaultGateway()`,本機 IPv4 是已知資料,只是沒拿來用。
- **最小改動**:抽一個純函式 + 改 store 一個段落 + 加測試,scope 約 30 LOC + 5 個測試 case。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| Trace 從 default gateway 起算 | Trace 從本機 IP 起算,gateway 變 hop 1 |
| 本機 IP 只出現在 `Local Interfaces` 區 | Trace 第一個 entry 顯示本機 IP,description 為 `本機` |
| 多 NIC 用戶看到錯誤的 IP | 取與 gateway 同 /24 的 NIC(若無則退回第一個非 internal IPv4) |

---

## 3. 檔案異動表 (File Structure)

| 動作     | 檔案                                | 職責                                                  |
| -------- | ----------------------------------- | ----------------------------------------------------- |
| New      | `src/topology/localIp.ts`           | `deriveLocalIp(interfaces, gateway): string \| null` |
| Modify   | `src/topology/topologyScanner.ts`   | `TracerouteHop.role?: "local"` 欄位(可選 marker)     |
| Modify   | `src/topology/topologyStore.ts`     | 呼叫 `deriveLocalIp`、prepend hop 0、render `本機`    |
| New      | `test/localIp.test.ts`              | 純函式測試                                            |
| Modify   | `test/topologyStore.test.ts`        | scan-level 整合測試                                   |
| Modify   | `test/topologyScanner.test.ts`      | 既有的整合 fixture 同步更新 assertion                  |
| Modify   | `package.json`                      | 0.3.7 → 0.3.8 (patch)                                 |

---

## 4. 實作步驟 (Tasks)

### Task 1: `deriveLocalIp` 純函式 (TDD)

**Files:**
- New: `src/topology/localIp.ts`
- New: `test/localIp.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/localIp.test.ts
import { describe, it, expect } from "vitest";
import { deriveLocalIp } from "../src/topology/localIp";
import type { NetworkInterface } from "../src/topology/topologyScanner";

const ipv4 = (address: string, internal = false) => ({ address, family: "IPv4" as const, internal });
const v6 = (address: string) => ({ address, family: "IPv6" as const, internal: false });

const ifaces = (...entries: { name: string; addresses: NetworkInterface["addresses"] }[]): NetworkInterface[] =>
    entries as unknown as NetworkInterface[];

describe("deriveLocalIp", () => {
    it("returns null when interfaces is empty", () => {
        expect(deriveLocalIp([], "192.168.1.1")).toBeNull();
    });

    it("returns null when no IPv4 address exists", () => {
        expect(deriveLocalIp(ifaces({ name: "en0", addresses: [v6("fe80::1")] }), "fe80::1")).toBeNull();
    });

    it("returns null when only loopback IPv4 exists", () => {
        expect(deriveLocalIp(ifaces({ name: "lo0", addresses: [ipv4("127.0.0.1", true)] }), "127.0.0.1")).toBeNull();
    });

    it("prefers IPv4 matching gateway's /24 subnet", () => {
        const result = deriveLocalIp(
            ifaces(
                { name: "en0", addresses: [ipv4("10.0.0.50"), v6("fe80::1")] },
                { name: "en1", addresses: [ipv4("192.168.1.100")] }
            ),
            "192.168.1.1"
        );
        expect(result).toBe("192.168.1.100");
    });

    it("falls back to first non-internal IPv4 when no gateway", () => {
        const result = deriveLocalIp(
            ifaces({ name: "en0", addresses: [ipv4("10.0.0.50"), v6("fe80::1")] }),
            null
        );
        expect(result).toBe("10.0.0.50");
    });

    it("falls back to first non-internal IPv4 when gateway has no /24 match", () => {
        const result = deriveLocalIp(
            ifaces(
                { name: "en0", addresses: [ipv4("10.0.0.50")] },
                { name: "en1", addresses: [ipv4("172.16.5.5")] }
            ),
            "192.168.1.1"
        );
        expect(result).toBe("10.0.0.50");
    });

    it("ignores malformed gateway IP", () => {
        const result = deriveLocalIp(
            ifaces({ name: "en0", addresses: [ipv4("10.0.0.50")] }),
            "not-an-ip"
        );
        expect(result).toBe("10.0.0.50");
    });

    it("aggregates IPv4 across multiple interfaces", () => {
        const result = deriveLocalIp(
            ifaces(
                { name: "en0", addresses: [v6("fe80::1")] },
                { name: "en1", addresses: [ipv4("192.168.1.100")] }
            ),
            "192.168.1.1"
        );
        expect(result).toBe("192.168.1.100");
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- localIp`
Expected: FAIL — module not found。

- [ ] **Step 3: 實作 `deriveLocalIp`**

```typescript
// src/topology/localIp.ts
import type { NetworkInterface } from "./topologyScanner";

/**
 * Pick the host's IPv4 address that should appear as hop 0 in a traceroute.
 *
 * Preference order:
 *   1. Non-internal IPv4 sharing the /24 with `gateway`
 *   2. First non-internal IPv4
 *   3. `null` (only loopback / IPv6 / no interfaces)
 */
export function deriveLocalIp(
    interfaces: NetworkInterface[],
    gateway: string | null
): string | null {
    if (!interfaces || interfaces.length === 0) return null;

    const ipv4s: string[] = [];
    for (const iface of interfaces) {
        for (const addr of iface.addresses ?? []) {
            if (addr.family === "IPv4" && !addr.internal) {
                ipv4s.push(addr.address);
            }
        }
    }
    if (ipv4s.length === 0) return null;

    const gwParts = gateway && /^\d+\.\d+\.\d+\.\d+$/.test(gateway)
        ? gateway.split(".")
        : null;
    if (gwParts && gwParts.length === 4) {
        const match = ipv4s.find((ip) => {
            const parts = ip.split(".");
            return parts.length === 4 &&
                parts[0] === gwParts[0] &&
                parts[1] === gwParts[1] &&
                parts[2] === gwParts[2];
        });
        if (match) return match;
    }

    return ipv4s[0];
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- localIp`
Expected: 8 case 全綠。

### Task 2: store prepend local hop + render `本機`

**Files:**
- Modify: `src/topology/topologyScanner.ts`
- Modify: `src/topology/topologyStore.ts`

- [ ] **Step 1: `TracerouteHop` 加 `role?: "local"`**

```typescript
// src/topology/topologyScanner.ts
export interface TracerouteHop {
    hop: string;
    ip: string;
    time: string;
    /** Marker set by TopologyStore when prepending the host's own IP. */
    role?: "local";
}
```

- [ ] **Step 2: store import + 用 `deriveLocalIp` 計算 localIp**

```typescript
// src/topology/topologyStore.ts
import { deriveLocalIp } from "./localIp";
```

- [ ] **Step 3: 在 `scan()` 內 prepend local hop**

在 `await Promise.all(...)` 解構後、組裝 nodes 前插入:

```typescript
const localIp = deriveLocalIp(interfaces, gateway);
const traceHops: TracerouteHop[] = (() => {
    if (!hops || hops.length === 0) return [];
    if (localIp && !hops.some((h) => h.ip === localIp)) {
        return [
            { hop: "0", ip: localIp, time: "", role: "local" },
            ...hops,
        ];
    }
    return hops;
})();
```

並把 `if (hops && hops.length > 0)` 改成 `if (traceHops.length > 0)`,迴圈內用 `traceHops` 取代 `hops`,type import 從 scanner 帶入。

- [ ] **Step 4: render 把 `role === "local"` 顯示為「本機」**

把兩處 hop node 組裝:

```typescript
{ label: h.ip, description: h.time || undefined }
```

統一改成:

```typescript
{ label: h.ip, description: h.role === "local" ? "本機" : (h.time || undefined) }
```

(共兩處:`if (subnet !== currentSubnet)` 內的 else + 後續的 else)

- [ ] **Step 5: 跑既有 store/scanner 測試確認**

Run: `npm test -- topologyStore topologyScanner`
Expected: 既有的 `topologyScanner.test.ts` 第一個 case 會 fail,因為 fixture 預期本機 IP 不在 trace — **那是預期的**,先確認其它 case 仍綠。下一個 Task 修 fixture。

### Task 3: 修既有 fixture + 新增 scan-level 測試

**Files:**
- Modify: `test/topologyScanner.test.ts`
- Modify: `test/topologyStore.test.ts`

- [ ] **Step 1: 更新 `topologyScanner.test.ts` 第一個 case**

原本 fixture:
```typescript
scanner.interfaces = [{ name: "en0", addresses: [{ address: "192.168.1.100", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:01" }, ...] }];
scanner.gateway = "192.168.1.1";
scanner.hops = [
    { hop: "1", ip: "192.168.1.1", time: "1.2ms" },
    ...
];
```

更新 assertion,讓 `hop1Group.children` 多一個 192.168.1.100 (description `本機`):

```typescript
const hop1Group = trace.children![0];
expect(hop1Group.label).toBe("192.168.1.0/24");
expect(hop1Group.children![0]).toEqual({ label: "192.168.1.100", description: "本機" });
const hop1Gateway = hop1Group.children![1];
expect(hop1Gateway).toEqual({ label: "192.168.1.1", description: "1.2ms" });
```

(下層 `hop2Group = hop1Group.children![1]` 變 `children![2]` 依序調整)

- [ ] **Step 2: 加 scan-level 整合測試**

```typescript
// test/topologyStore.test.ts (append)
it("scan prepends local IPv4 matching gateway /24 to trace", async () => {
    const transport = fakeTransport(
        [{ name: "en0", addresses: [{ address: "192.168.1.100", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:ff" }] }],
        "192.168.1.1",
        [{ hop: "1", ip: "192.168.1.1", time: "1.2ms" }],
        [],
        []
    );
    const store = new TopologyStore(transport);
    await store.scan();

    const routing = store.getRoots().find((n) => n.label === "Routing")!;
    const trace = routing.children!.find((c) => c.label.startsWith("Trace"))!;
    // First subgroup is the /24, with local IP as first child
    const subnetGroup = trace.children![0];
    expect(subnetGroup.label).toBe("192.168.1.0/24");
    expect(subnetGroup.children![0]).toEqual({ label: "192.168.1.100", description: "本機" });
    expect(subnetGroup.children![1]).toEqual({ label: "192.168.1.1", description: "1.2ms" });
});

it("scan does not duplicate local IP if already in trace", async () => {
    const transport = fakeTransport(
        [{ name: "en0", addresses: [{ address: "192.168.1.100", family: "IPv4", internal: false, mac: "aa" }] }],
        "192.168.1.1",
        [
            { hop: "1", ip: "192.168.1.100", time: "0.1ms" },  // unusual but possible (loop)
            { hop: "2", ip: "192.168.1.1", time: "1.2ms" },
        ],
        [],
        []
    );
    const store = new TopologyStore(transport);
    await store.scan();

    const trace = store.getRoots()
        .find((n) => n.label === "Routing")!
        .children!.find((c) => c.label.startsWith("Trace"))!;
    const subnetGroup = trace.children![0];
    expect(subnetGroup.children).toHaveLength(2);  // no duplicate
});

it("scan skips prepending when interfaces has no usable IPv4", async () => {
    const transport = fakeTransport(
        [{ name: "lo0", addresses: [{ address: "127.0.0.1", family: "IPv4", internal: true, mac: "" }] }],
        "192.168.1.1",
        [{ hop: "1", ip: "192.168.1.1", time: "1.2ms" }],
        [],
        []
    );
    const store = new TopologyStore(transport);
    await store.scan();

    const trace = store.getRoots()
        .find((n) => n.label === "Routing")!
        .children!.find((c) => c.label.startsWith("Trace"))!;
    // Gateway itself is the only entry — no local hop
    expect(trace.children).toHaveLength(1);
    expect(trace.children![0].children).toHaveLength(1);
    expect(trace.children![0].children![0].label).toBe("192.168.1.1");
});

it("scan does not show trace when hops are empty even if localIp exists", async () => {
    const transport = fakeTransport(
        [{ name: "en0", addresses: [{ address: "192.168.1.100", family: "IPv4", internal: false, mac: "aa" }] }],
        "192.168.1.1",
        [],  // no hops
        [],
        []
    );
    const store = new TopologyStore(transport);
    await store.scan();

    const routing = store.getRoots().find((n) => n.label === "Routing");
    expect(routing).toBeUndefined();  // only gateway, no trace
});
```

- [ ] **Step 3: 跑全部測試**

Run: `npm test`
Expected: 195 (baseline) + 8 (localIp) + 4 (topologyStore) = ~207 全綠。

### Task 4: build + 版本號

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 跑 build**

Run: `npm run build`
Expected: 成功,VSIX 產出。

- [ ] **Step 2: bump 0.3.7 → 0.3.8**

```diff
-    "version": "0.3.7",
+    "version": "0.3.8",
```

- [ ] **Step 3: 跑 `npm test` 最後確認**

Run: `npm test`
Expected: 全綠。

### Task 5: 文件 + commit

- [ ] **Step 1: README.todo P1 標完成**

```diff
-- [ ] [P1] deal with network topology routing parsing error (host ip adress is not listed in trace path)
+- [x] [P1] deal with network topology routing parsing error (host ip adress is not listed in trace path) — deriveLocalIp from interfaces + gateway subnet match, prepend as hop 0 with description "本機". See [docs/specs/2026-06-30-topology-trace-local-ip.md](docs/specs/2026-06-30-topology-trace-local-ip.md).
```

- [ ] **Step 2: commit**

```bash
git add src/topology/localIp.ts src/topology/topologyScanner.ts src/topology/topologyStore.ts \
        test/localIp.test.ts test/topologyStore.test.ts test/topologyScanner.test.ts \
        package.json README.todo
git commit -m "fix(topology): prepend host IPv4 to traceroute path"
```

- [ ] **Step 3: 計畫搬進 docs/specs/**

```bash
git mv plans/2026-06-30-feature-topology-trace-local-ip.md \
       docs/specs/2026-06-30-topology-trace-local-ip.md
git commit -m "docs(specs): archive topology trace local-ip plan"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| 多 NIC 用戶挑錯 NIC IP | `/24` subnet match gateway;fallback 第一個非 internal IPv4 | 把 `deriveLocalIp` 換成 `null` 強制不 prepend |
| trace 指令輸出已含本機 IP(罕見,loop) | `hops.some(h => h.ip === localIp)` 跳過 prepend | 拿掉那段 skip 邏輯 |
| IPv6 trace 環境 | `deriveLocalIp` 只看 IPv4,IPv6 trace 仍會落到現有 IPv4 subnet 分組(可能空白);只在 IPv4 hops 才 prepend | 在 prepend 前加 `if (traceHops.every(h => /^\d+\.\d+\.\d+\.\d+$/.test(h.ip)))` gate |
| fixture 改動影響其它測試 | `topologyScanner.test.ts` 第一個 case 是唯一整合測試,其它 store-only case 用 `fakeTransport()` 不依賴 scanner fixture | 還原 assertion 至 pre-fix 版本 |

---

## 6. 完成定義

- [ ] 8 個 `localIp.test.ts` case 綠
- [ ] 4 個新 `topologyStore.test.ts` case 綠
- [ ] 既有的 4 個 `topologyStore.test.ts` + 6 個 `topologyScanner.test.ts` 仍綠(fixture 已更新)
- [ ] `npm run build` 成功,VSIX 產出
- [ ] `package.json` version 0.3.8
- [ ] README.todo P1 標記完成
- [ ] 計畫歸檔至 `docs/specs/`

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `## Topology` 段 P1 條目
- 既有模組: `src/topology/topologyStore.ts:scan`, `src/topology/topologyScanner.ts:traceroute`
- 測試位置: `test/topologyStore.test.ts`, `test/topologyScanner.test.ts`, `test/topologyScanner.fake.ts`
- 相關計畫: [`plans/2026-06-23-feature-topology-background-scan.md`](2026-06-23-feature-topology-background-scan.md)