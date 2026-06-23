# 加入 EXPLORE 與 MDNS 子面板視圖 (Implementation Plan)

> 實作順序: 逐項完成,每階段驗證後才進行下一階段。

---

## Context

目前 Superset 擴充功能有一個 `superset` 活動列容器,內含單一 `superset.terminals` TreeView。使用者要求:

1. **Feature 1 (跳過)** — 目前已經是 TreeView,不需改動
2. **Feature 2** — 加入 EXPLORE 子面板,顯示工作區檔案樹 (如 VSCode 內建 Explorer)
3. **Feature 3** — 加入 MDNS 子面板,偵測區域網路 mDNS/Bonjour 服務並顯示發現的目標

`★ Insight ─────────────────────────────────────`
- VSCode `viewsContainers` 支援在同一個 activitybar 容器下註冊多個 `view`,每個 view 會自動獲得獨立的標題列與摺疊箭頭 — 不需要自繪 HTML/CSS webview。
- `tsserver` 在 `*.ts` 中有 `const enum` 展開問題,`multicast-dns` 的 `packet` 型別可能觸發 `isolatedModules` 錯誤。防禦策略: 用 `MdnsTransport` 介面隔離,提前在 Task 2 驗證編譯。
- mDNS 純 JS 不用 native binding,在所有平台 (macOS/Windows/Linux) 都能在 VSCode Extension Host 跑,不需 `node-gyp`。
`─────────────────────────────────────────────────`

---

## 架構總覽

三個 view 共用同一個 `superset` activitybar 容器,VSCode 自動將它們渲染為各自獨立的可摺疊區段:

```
superset (activitybar icon)
├── Terminals   (既有 TreeView, 不改)
├── Explore     (新增 TreeView, 工作區檔案樹)
└── MDNS        (新增 TreeView, mDNS 服務清單)
```

資料層延續既有模式: 純資料層 (no vscode imports) → TreeDataProvider (vscode-bound) → TreeView。

---

## 實作任務

### Stage 1: package.json 註冊新 views (結構先行)

**目的:** 先在 manifest 宣告三個 view,確保編譯與既有測試通過,再逐步加入實作。

**檔案:** `package.json`

**改動:**
- `views.superset` 陣列加入 `superset.explore` 與 `superset.mdns`:
  ```json
  "views": {
      "superset": [
          { "id": "superset.terminals", "name": "Terminals" },
          { "id": "superset.explore",   "name": "Explore" },
          { "id": "superset.mdns",      "name": "MDNS" }
      ]
  }
  ```
- 加 `menus.view/title` 項目 (refresh 按鈕):
  ```json
  { "command": "superset.exploreRefresh", "when": "view == superset.explore", "group": "navigation" },
  { "command": "superset.mdnsRefresh",    "when": "view == superset.mdns",    "group": "navigation" }
  ```
- 加 `commands` 宣告:
  ```json
  { "command": "superset.exploreRefresh", "title": "Refresh Explorer", "icon": "$(refresh)" },
  { "command": "superset.mdnsRefresh",    "title": "Refresh mDNS",    "icon": "$(refresh)" },
  { "command": "superset.mdnsCopy",       "title": "Copy Service Address" },
  { "command": "superset.exploreOpen",    "title": "Open File" }
  ```
- 加 `menus.view/item/context`:
  ```json
  { "command": "superset.mdnsCopy",    "when": "viewItem == mdnsService", "group": "1_focus" },
  { "command": "superset.exploreOpen", "when": "viewItem == explorerFile", "group": "1_focus" }
  ```

**驗證:**
```bash
npm test  # 48 個既有 test 全綠
```

---

### Stage 2: EXPLORE — 純資料層 ExplorerStore

**目的:** 建立工作區檔案樹的純資料層,與 `TerminalRegistry` 相同模式 (observer pattern, no vscode imports)。

**新增檔案:** `src/explorerStore.ts`

**設計:**
```ts
export interface FsAdapter {
    readDirectory(uri: string): Promise<Array<{name: string; isDirectory: boolean}>>;
    getWorkspaceRoots(): string[];
    onDidChangeWorkspace(cb: () => void): () => void;
    onDidChangeFiles(cb: (uris: string[]) => void): () => void;
}

export interface ExplorerNode {
    readonly uri: string;       // 相對於工作區根目錄的路徑
    readonly name: string;
    readonly isDirectory: boolean;
    children?: ExplorerNode[];  // undefined = 尚未列舉
}

export type ExplorerChange =
    | { type: "rootChanged" }
    | { type: "nodeChanged"; uri: string }
    | { type: "nodeRemoved"; uri: string };

export type ExplorerListener = (change: ExplorerChange) => void;

export class ExplorerStore {
    // 注入 FsAdapter; 在 extension.ts 用 vscode.workspace.fs 實作
    // getRoots(), getChildren(uri), refresh(uri), onDidChange()
}
```

**新增檔案:** `test/explorerStore.test.ts`
- 使用 in-memory FakeFsAdapter 測試
- 約 6 個 case: getChildren 延遲列舉, getParent, refresh, 監聽器取消

**驗證:**
```bash
npm test  # 48 + ~6 = 54 個 test 全綠
```

---

### Stage 3: EXPLORE — TreeDataProvider 與 spec

**目的:** 將 ExplorerStore 包裝成 VSCode TreeDataProvider,顯示在 `superset.explore` view。

**新增檔案:**
- `src/explorerTreeSpec.ts` — 純函式,產生 `TreeItemSpec` (與 `treeSpec.ts` 平行)
- `src/explorerTreeProvider.ts` — `vscode.TreeDataProvider<ExplorerNode>`,訂閱 `ExplorerStore.onDidChange`
- `test/explorerTreeSpec.test.ts` — 約 3 個 case

**explorerTreeProvider.ts 關鍵行為:**
- `getChildren(undefined)` → workspace roots
- `getChildren(node)` → 延遲列舉 node.children
- `getParent(node)` → 從 URI 路徑推導父節點
- 點擊檔案 → `superset.exploreOpen` 命令 → `vscode.window.showTextDocument`

**新增檔案:** `src/fsAdapter.ts` — `VscodeFsAdapter` 實作 `FsAdapter`,放在單獨檔案方便測試 mock。

**驗證:**
```bash
npm test  # 54 + ~3 = 57 個 test 全綠
```

---

### Stage 4: EXPLORE 組裝到 extension.ts

**改動:** `src/extension.ts`

在 activate() 內加入:
```ts
// ── Explorer ────────────────────────────────────────────
const explorerStore = new ExplorerStore(new VscodeFsAdapter());
explorerStore.start();
const explorerProvider = new ExplorerTreeProvider(explorerStore);
explorerProvider.start();
subscriptions.push({ dispose: () => explorerProvider.stop() });
subscriptions.push({ dispose: () => explorerStore.stop() });

const explorerView = vscode.window.createTreeView("superset.explore", {
    treeDataProvider: explorerProvider,
    showCollapseAll: true,
});
subscriptions.push(explorerView);

// commands
subscriptions.push(vscode.commands.registerCommand("superset.exploreRefresh",
    () => { explorerStore.refreshAll(); explorerProvider.refresh(); }));
subscriptions.push(vscode.commands.registerCommand("superset.exploreOpen",
    async (node: ExplorerNode | undefined) => {
        if (!node || node.isDirectory) return;
        const uri = vscode.Uri.file(node.uri);
        await vscode.commands.executeCommand("vscode.open", uri);
    }));
```

**驗證:**
```bash
npm test         # 57 個 test 全綠
npm run build    # 編譯成功
```

---

### Stage 5: MDNS — 安裝相依套件

**目的:** 安裝 `multicast-dns` 純 JS mDNS 實作。

```bash
npm install multicast-dns
npm install -D @types/multicast-dns
```

若 `@types/multicast-dns` 不存在,則建立 `src/multicast-dns.d.ts` 環境宣告。

**驗證:**
```bash
npm test  # 57 個 test 全綠, 無 regression
```

---

### Stage 6: MDNS — 傳輸層 MdnsTransport

**目的:** 建立 mDNS 傳輸抽象層,隔離 `multicast-dns` 套件,讓測試可用 fake transport。

**新增檔案:** `src/mdnsTransport.ts`

```ts
export interface MdnsPacket {
    answers: Array<{
        name: string;
        type: string;       // "A" | "AAAA" | "PTR" | "SRV" | "TXT"
        ttl: number;
        data: unknown;
    }>;
}

export interface MdnsTransport {
    start(): void;
    stop(): void;
    browse(): void;
    onPacket(cb: (pkt: MdnsPacket) => void): () => void;
}
```

同時在 `src/mdnsTransport.ts` 實作 `MulticastDnsTransport`:
- 包裝 `multicast-dns` 的 `create()` / `query()` / `on("response")` / `destroy()`
- 將 `packet` 事件投影成 `MdnsPacket`

**驗證:**
```bash
npm test  # 57 個 test 全綠
```

---

### Stage 7: MDNS — 純資料層 MdnsRegistry

**目的:** 建立 mDNS 服務登錄檔,與 `TerminalRegistry` 相同模式。

**新增檔案:** `src/mdnsRegistry.ts`

```ts
export class MdnsRegistry {
    private services = new Map<string, MdnsService>();
    // constructor(transport: MdnsTransport)
    // start() / stop() / getAll() / onDidChange()
    // handlePacket() — 合併 PTR/SRV/TXT/A 記錄為單一 MdnsService
    // 250ms debounce 合併同一 UDP datagram 的多筆記錄
}
```

**擴充:** `src/types.ts` 加入 `MdnsService` / `MdnsChange` / `MdnsListener` 型別。

**新增檔案:** `test/mdnsRegistry.test.ts`
- 使用 `FakeMdnsTransport` 注入預製封包
- 約 8 個 case: add/remove/update, 合併邏輯, debounce, 監聽器取消

**驗證:**
```bash
npm test  # 57 + ~8 = 65 個 test 全綠
```

---

### Stage 8: MDNS — TreeDataProvider 與 spec

**目的:** 將 MdnsRegistry 包裝成 VSCode TreeDataProvider,顯示在 `superset.mdns` view。

**新增檔案:**
- `src/mdnsTreeSpec.ts` — 純函式,將 `MdnsService` 轉成 `MdnsTreeItemSpec`
- `src/mdnsTreeProvider.ts` — `vscode.TreeDataProvider<MdnsGroup | MdnsService>`,兩層樹: 服務類型 → 服務實例
- `test/mdnsTreeSpec.test.ts` — 約 4 個 case

**mdnsTreeProvider.ts 關鍵行為:**
- `getChildren(undefined)` → 依 `_type` 分組 (e.g. `_http._tcp`, `_ssh._tcp`)
- `getChildren(group)` → 該類型的服務清單
- 每列顯示 `name`, `description` 為 `host:port`
- 點擊服務 → `superset.mdnsCopy` → 複製 `host:port` 到剪貼簿

**驗證:**
```bash
npm test  # 65 + ~4 = 69 個 test 全綠
```

---

### Stage 9: MDNS 組裝到 extension.ts

**改動:** `src/extension.ts`

在 activate() 內加入:
```ts
// ── mDNS ────────────────────────────────────────────────
const mdnsRegistry = new MdnsRegistry(new MulticastDnsTransport());
mdnsRegistry.start();
const mdnsProvider = new MdnsTreeProvider(mdnsRegistry);
mdnsProvider.start();
subscriptions.push({ dispose: () => mdnsProvider.stop() });
subscriptions.push({ dispose: () => mdnsRegistry.stop() });

const mdnsView = vscode.window.createTreeView("superset.mdns", {
    treeDataProvider: mdnsProvider,
    showCollapseAll: true,
});
subscriptions.push(mdnsView);

// commands
subscriptions.push(vscode.commands.registerCommand("superset.mdnsRefresh",
    () => { mdnsRegistry.refresh(); }));
subscriptions.push(vscode.commands.registerCommand("superset.mdnsCopy",
    async (svc: MdnsService | undefined) => {
        if (!svc) return;
        const target = svc.host ?? svc.addresses[0];
        if (target) {
            await vscode.env.clipboard.writeText(`${target}:${svc.port}`);
            vscode.window.showInformationMessage(`已複製 ${target}:${svc.port}`);
        }
    }));
```

**驗證:**
```bash
npm test         # 69 個 test 全綠
npm run build    # 編譯成功
```

---

### Stage 10: 端到端手動驗證

在 VSCode Extension Host 中啟動:

1. **側欄結構:** 確認 `superset` 圖示下有三個可摺疊區段: Terminals / Explore / MDNS
2. **Explore:** 展開資料夾,確認檔案樹正確顯示,點擊 `.ts` 檔案在編輯器開啟
3. **MDNS:** 在支援 mDNS 的網路 (macOS 預設支援) 中,確認區域網路服務出現 (如 `_http._tcp`, `_ssh._tcp`)
4. **既有功能:** 確認 Terminals 面板的終端機清單、群組、unseen highlight 正常運作
5. **狀態列:** 確認狀態列 highlight 不受影響

---

## 風險與緩解

| 風險 | 緩解 |
|---|---|
| `multicast-dns` 型別不相容 `isolatedModules` | Task 5 先裝套件,立即 `npm run build` 驗證; 若失敗則手寫 `.d.ts` |
| macOS 首次 mDNS 需 local network 權限 | 在 diag channel 記錄 "mDNS awaiting local-network permission" |
| 大型工作區 (10k+ 檔案) 導致 Explore 載入慢 | `ExplorerStore` 延遲列舉子目錄 (`children === undefined`) |
| 既有 48 個 test regression | 每階段結束後 `npm test` 把關; 不修改任何既有測試檔案 |

---

## 檔案總覽

| 檔案 | 狀態 | 職責 |
|---|---|---|
| `package.json` | 修改 | 註冊 views + commands + menus |
| `src/types.ts` | 修改 | 加 `MdnsService` / `ExplorerNode` 等型別 |
| `src/explorerStore.ts` | **新增** | 工作區檔案樹純資料層 |
| `src/fsAdapter.ts` | **新增** | `FsAdapter` 介面 + `VscodeFsAdapter` 實作 |
| `src/explorerTreeSpec.ts` | **新增** | Explorer node → TreeItemSpec 純函式 |
| `src/explorerTreeProvider.ts` | **新增** | Explorer TreeDataProvider (vscode-bound) |
| `src/mdnsTransport.ts` | **新增** | `MdnsTransport` 介面 + `MulticastDnsTransport` 實作 |
| `src/mdnsRegistry.ts` | **新增** | mDNS 服務登錄檔純資料層 |
| `src/mdnsTreeSpec.ts` | **新增** | MdnsService → TreeItemSpec 純函式 |
| `src/mdnsTreeProvider.ts` | **新增** | MDNS TreeDataProvider (vscode-bound) |
| `src/extension.ts` | 修改 | 組裝新 views + commands |
| `test/explorerStore.test.ts` | **新增** | ~6 cases |
| `test/explorerTreeSpec.test.ts` | **新增** | ~3 cases |
| `test/mdnsRegistry.test.ts` | **新增** | ~8 cases |
| `test/mdnsTreeSpec.test.ts` | **新增** | ~4 cases |