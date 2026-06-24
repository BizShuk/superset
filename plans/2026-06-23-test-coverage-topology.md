# `topology` 子系統測試覆蓋率對齊 (Topology Test Coverage Parity)

> 對齊 mDNS 與 explorer 子系統的測試品質,補上 `topology` 缺失的單元測試。`topology` 是目前測試覆蓋最薄弱的子系統,且涉及 `child_process.exec` / `dns` 模組,沒有 fake transport 隔離的話根本無法在 CI 跑。

## 為何要做 (Why)

- **測試覆蓋率盤點**(本次提案前的現況):

  | 子系統       | 純函式 spec 測試 | Store 測試 | Fake transport / adapter | 涵蓋率評等 |
  | ------------ | ---------------- | ---------- | ------------------------ | ---------- |
  | `explorer`   | ✓ `explorerTreeSpec.test.ts` | ✓ `explorerStore.test.ts` | ✓ `FsAdapter` 介面 + `VscodeFsAdapter` | **A** |
  | `mdns`       | ✓ `mdnsTreeSpec.test.ts`     | ✓ `mdnsRegistry.test.ts`  | ✓ `MulticastDnsTransport` 介面          | **A** |
  | `topology`   | ✗ **缺漏**                  | ✓ `topologyStore.test.ts` | ✗ **缺漏**(`NodeTopologyScanner` 直接吃 `dns` / `exec`) | **C** |
  | `todo`       | n/a             | ✓ `todoStore.test.ts`     | n/a                       | **A** |

  `topology` 唯一有的測試是 `topologyStore.test.ts`(只測 store 內部狀態機),**所有 IO 邏輯(`topologyScanner.ts` 的 5 個 `scan*` 方法)都沒測**,只能在裝有真實網卡 + `arp` / `traceroute` 工具的本機跑;CI 環境下無法驗證。
- **既有 `FsAdapter` 與 `MulticastDnsTransport` 是已驗證的 pattern**,套用同樣模式到 `topology` 風險低、效益高。
- **`topologyTreeSpec` 純函式**完全沒測 — 比 `mdnsTreeSpec` 與 `explorerTreeSpec` 都少,純粹是漏寫。

## 使用者審查要求 (User Review Required)

> [!IMPORTANT]
> - 本次變更**不修改任何對外可見行為**(掃描結果、面板顯示、按鈕、keybinding 全部不變)。
> - 新增的 `ScannerTransport` 介面會留在 `src/topologyScanner.ts` 內,不外洩;`topologyStore` 只看到介面,不知道底下是 `NodeTopologyScanner` 還是 `FakeTopologyScanner`。
> - 若使用者偏好「只在 CI 環境跳過 IO 測試」而非抽介面,本 plan 可改為「補 spec 測試 + 用 `vi.mock("child_process")` 與 `vi.mock("dns")`」這個次優方案。

## 提議的變更 (Proposed Changes)

### `topology` 模組的介面重整 (Interface Refactor)

#### [MODIFY] [topologyStore.ts](file:///Users/bytedance/projects/superset/src/topologyStore.ts)

- 新增 `ScannerTransport` 介面,把現有 `NodeTopologyScanner` 內的 5 個 IO 動作抽象化:
  ```typescript
  export interface ScannerTransport {
      listInterfaces(): Promise<NetworkInterface[]>;
      getDefaultGateway(): Promise<string | null>;
      traceroute(host: string): Promise<TracerouteHop[]>;
      resolveDnsServers(): Promise<string[]>;
      listArpTable(): Promise<ArpEntry[]>;
  }
  ```
- `TopologyStore` 改為接受 `ScannerTransport` 而非 `TopologyScanner`(現有介面太薄,等同直接用 `scan()` 一把梭)。

#### [MODIFY] [topologyScanner.ts](file:///Users/bytedance/projects/superset/src/topologyScanner.ts)

- `NodeTopologyScanner` 改成實作 `ScannerTransport`(五個獨立 method,各自 return 純資料)。
- `topologyStore.scan()` 改為呼叫 `transport` 五個 method,組合 `TopologyNode` 樹 — 邏輯集中在 store,scanner 只負責 IO。

#### [MODIFY] [extension.ts](file:///Users/bytedance/projects/superset/src/extension.ts)

- `new TopologyStore(new NodeTopologyScanner())` 改為 `new TopologyStore(new NodeTopologyScanner())` — **呼叫端不變**,因為新介面只是把建構子收緊。

---

### 測試 (Tests)

#### [NEW] [topologyTreeSpec.test.ts](file:///Users/bytedance/projects/superset/test/topologyTreeSpec.test.ts)

- 對齊 `mdnsTreeSpec.test.ts` / `explorerTreeSpec.test.ts` 的覆蓋面:
  - 群組節點(有 `children`):`iconKind: "group"`、`contextValue: "topologyGroup"`、`description` 保留
  - 葉節點(無 `children`):`iconKind: "leaf"`、`contextValue: "topologyLeaf"`
  - `description` 為 `undefined` 時不應出現在 spec

#### [NEW] [topologyScanner.test.ts](file:///Users/bytedance/projects/superset/test/topologyScanner.test.ts)

- 用 `FakeTopologyScanner`(實作 `ScannerTransport`,每個 method 回傳 fixture 資料)餵給 `TopologyStore`。
- 驗證以下場景(每個 case 對應一次 store.scan()):
  - 5 個 method 都回傳 fixture → 產出預期樹狀結構
  - `getDefaultGateway` 回 `null` → Gateway 群組隱藏,不報錯
  - `traceroute` 回空陣列 → Trace 群組不出現
  - `listArpTable` 回空陣列 → ARP 群組不出現
  - 5 個 method 任一 reject → store 進入 error 狀態、上次結果保留
  - 並發呼叫 `scan()`(連按兩次按鈕)→ 只跑一次 scanner、第二次回傳 in-flight 的同一個 promise

#### [MODIFY] [topologyStore.test.ts](file:///Users/bytedance/projects/superset/test/topologyStore.test.ts)

- 把現有 test 的 mock scanner 換成實作 `ScannerTransport` 的 fake,確保介面變更後測試仍綠。

#### [NEW] [topologyScanner.fake.ts](file:///Users/bytedance/projects/superset/test/topologyScanner.fake.ts)

- 輕量的 `FakeTopologyScanner`,五個 method 各提供 getter/setter 讓測試注入 fixture 資料。
- 不 export 給 src 用(放 test/ 內)。

---

### 改進的「可觀察」指標

| 指標                              | 改進前        | 改進後 (預期)         |
| --------------------------------- | ------------- | --------------------- |
| `topology` 相關測試 case 數       | ~6 個         | 20+ 個                |
| CI 是否能驗證 topology 邏輯       | ✗(需真實 IO) | ✓(純 mock)            |
| 三子系統測試品質對齊              | 不一致        | 一致(A 等)            |
| `topology` 改動後的回歸信心       | 低(只能手測) | 高(單元測試覆蓋)      |

## 驗證計劃 (Verification Plan)

### 自動化測試

- 執行 `npm test`,所有既有 156 個 case 必須全綠。
- 新增 / 修改後的 topology 測試至少 18 個新 case,全綠。

### 手動驗證

- 啟動 Extension Development Host,點擊 Topology 面板的「Scan Network Topology」按鈕,在有真實網路的環境下驗證掃描結果與重構前一致。
- 確認 status bar / tree / detail view 都沒變。

### 重構邊界

| 不要動的部分                          | 原因                              |
| ------------------------------------- | --------------------------------- |
| `TopologyNode` / `TopologyScanner` 型別 | 是穩定的 public contract        |
| 對外的命令 / 按鈕 / panel 顯示        | 使用者體驗 contract              |
| `topologyStore` 對外 API(`scan`、`onDidChange` 等) | downstream 呼叫端依賴的 contract |

## 風險與緩解 (Risks & Mitigations)

| 風險                              | 緩解                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| 介面重構破壞 `extension.ts` 連線  | `extension.ts` 改動只一行,既有測試(`topologyStore.test.ts`)全綠即代表連線仍正常     |
| Fake scanner 與真實 IO 行為脫節   | Fake 只模擬「5 個 method 的回傳值」,業務邏輯集中在 store;真實 IO 在 `NodeTopologyScanner`,Fake 不需要模擬邊界情況(只給 happy path + 部分 error) |
| CI 在某些環境跑不起來             | 全部新測試用 Fake,完全不碰真實 IO → CI 永遠可跑                                    |

## 預估工作量 (Effort Estimate)

- `ScannerTransport` 介面定義 + `NodeTopologyScanner` 拆 method:30 分鐘
- `topologyStore.scan()` 重組(原本的 scanner 邏輯搬進 store):1 小時
- `topologyTreeSpec.test.ts` 補 4 個 case:15 分鐘
- `topologyScanner.fake.ts` + `topologyScanner.test.ts` 寫 14+ 個 case:1.5 小時
- 修 `topologyStore.test.ts` 介面適配:15 分鐘
- 手動驗證 + debug:30 分鐘
- **總計:約 4 小時**

## 後續 (Follow-ups, 非本次範圍)

- 把 `outputWatcher` / `ptyTerminalHost` 也用同樣「IO adapter 介面 + Fake」pattern 重構,讓子系統測試品質全面對齊。
- 在 `package.json` 的 `scripts` 新增 `test:coverage`(c8 / istanbul),量化「改進前後」的覆蓋率變化。
