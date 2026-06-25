# 加入 Network Topology 子面板

> 顯示從本機到公網的網路拓撲,按 Scan 按鈕才開始掃描。

---

## Context

使用者要求新增第四個子面板 `superset.topology`,顯示網路拓撲資訊 (本機介面 → 閘道 → 路由追蹤 → DNS → ARP 表)。掃描由使用者手動觸發 (點擊 Scan 按鈕),初始狀態為空,不自動掃描。

---

## 架構

```
superset (activitybar icon)
├── Terminals
├── Explore
├── MDNS
└── Topology    ← 新增
```

```
▼ 本機介面
  ├── en0: 192.168.1.42 (fe80::1)
  └── lo0: 127.0.0.1
▼ 路由
  ├── 預設閘道: 192.168.1.1
  └─▼ 追蹤 8.8.8.8
      ├── 1: 192.168.1.1 (1.2ms)
      ├── 2: 10.0.0.1 (5.3ms)
      └── 3: * * *
▼ DNS 伺服器
  ├── 8.8.8.8
  └── 1.1.1.1
▼ ARP 表
  ├── 192.168.1.1 (aa:bb:cc:dd:ee:ff)
  └── 192.168.1.100 (11:22:33:44:55:66)
```

---

## 資料層

### `src/types.ts` 新增型別

```ts
export interface TopologyNode {
    readonly label: string;
    readonly description?: string;
    readonly children?: TopologyNode[];
}

export type TopologyChange = { type: "scanned"; nodes: TopologyNode[] };
export type TopologyListener = (change: TopologyChange) => void;
```

### `src/topologyStore.ts` (純資料層, no vscode imports)

```ts
export interface TopologyScanner {
    scan(): Promise<TopologyNode[]>;
}

export class TopologyStore {
    // 注入 scanner
    // getRoots(): TopologyNode[] — 空陣列直到 scan 完成
    // scan(): Promise<void> — 觸發掃描
    // onDidChange(listener): unsubscribe
}
```

### `src/topologyScanner.ts` (vscode-bound, 執行命令)

實作 `TopologyScanner`,用 Node.js 內建模組:
- `os.networkInterfaces()` → 本機介面
- `child_process.exec("route -n get default")` → 預設閘道 (macOS)
- `child_process.exec("traceroute -m 10 -w 1 8.8.8.8")` → 路由追蹤
- `dns.getServers()` → DNS 伺服器
- `child_process.exec("arp -a")` → ARP 表

---

## 實作步驟

### Step 1: package.json 註冊 view + commands + menus

- views: 加 `superset.topology`
- commands: `superset.topologyScan` (icon: `$(sync~spin)`)
- menus.view/title: scan button for `superset.topology`

### Step 2: 型別 + 純資料層 TopologyStore

- `src/types.ts`: 加 `TopologyNode`, `TopologyChange`, `TopologyListener`
- `src/topologyStore.ts`: 純資料層, observer pattern
- `test/topologyStore.test.ts`: ~5 cases

### Step 3: 掃描器 TopologyScanner

- `src/topologyScanner.ts`: 執行系統命令,解析輸出
- 跨平台處理 (macOS `route get` / Linux `ip route` / Windows `route print`)

### Step 4: TreeDataProvider

- `src/topologyTreeProvider.ts`
- `src/topologyTreeSpec.ts`

### Step 5: 組裝到 extension.ts

- 建立 TopologyStore + TopologyScanner + TreeView
- 註冊 `superset.topologyScan` 命令

### Step 6: 驗證

- `npm test` 全綠
- `npm run build` 成功
- 手動測試: 按 Scan → 顯示拓撲

---

## 檔案總覽

| 檔案 | 狀態 | 職責 |
|---|---|---|
| `package.json` | 修改 | 註冊 view + commands + menus |
| `src/types.ts` | 修改 | 加 `TopologyNode` 等型別 |
| `src/topologyStore.ts` | **新增** | 純資料層 |
| `src/topologyScanner.ts` | **新增** | 執行系統命令,解析輸出 |
| `src/topologyTreeProvider.ts` | **新增** | TreeDataProvider |
| `src/topologyTreeSpec.ts` | **新增** | spec builder |
| `src/extension.ts` | 修改 | 組裝 view + commands |
| `test/topologyStore.test.ts` | **新增** | ~5 cases |