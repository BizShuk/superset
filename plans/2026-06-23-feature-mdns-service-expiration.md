# mDNS service expiration:自動過期 (Auto-expire stale mDNS services)

> 為 `MdnsRegistry` 新增「grace period 過期」邏輯 — 服務在某段時間內沒收到新封包就從清單中移除,避免面板永遠塞滿已離線的舊服務。

## 為何要做 (Why)

- **`README.todo` 既有條目「Add mDNS service expiration」自 2026-06-20 起一直未勾**,無對應 plan。本 plan 把這個懸而未決的項目升格為可執行設計。
- **現行 `MdnsRegistry` 沒有過期機制**(`src/mdnsRegistry.ts` 的 `services: Map` 只增不減),導致:
  - 一台筆電走過一輪咖啡廳後,「mDNS 面板」會留下所有曾經發現但已離網的服務。
  - 服務可能換了 IP(`srcAddress` 不同),但因為 key 用 `name + type + domain`,同名同型服務就會被視為「同一個」並更新 `addresses` — 但若服務整個消失,殘留的 IP 仍是錯的。
  - 面板成長無界,debug 時難以快速識別「現在真正能用的」服務。
- **mDNS 本身有 TTL 機制**(DNS-SD 規範),合理的服務會在過期前主動重發;沒重發的服務就視為已離線 — 這是 RFC 6762 / 6763 的標準做法。

## 使用者審查要求 (User Review Required)

> [!IMPORTANT]
> - 過期判斷策略有兩種候選,**需要使用者決定**:
>   - **A. TTL 為主**:`now - lastSeen > service.ttl * 3`(3 倍 TTL grace period,符合 RFC 6762 §10.1 的「cache flush」概念)
>   - **B. 絕對時間**:`now - lastSeen > MAX_SERVICE_AGE`(例如 5 分鐘,簡單但與 DNS 規範脫鉤)
>   - 推薦 A:貼近 DNS 標準 + 自動適應「短 TTL 服務快速過期、長 TTL 服務慢過期」的合理行為。
> - **使用者要不要能在設定檔(`package.json` 的 `contributes.configuration`)覆寫 grace period 倍數?**
>   - 預設:不開放,寫死常數 `TTL_GRACE_MULTIPLIER = 3`。
> - 過期時要不要觸發 `MdnsChange: "removed"` 事件?預設:**要**(讓面板即時更新)。
> - 是否影響既有 `MdnsService.lastSeen` 欄位?不會動欄位本身,只是新增讀取邏輯。

## 提議的變更 (Proposed Changes)

### Registry 邏輯 (Registry)

#### [MODIFY] [mdnsRegistry.ts](file:///Users/bytedance/projects/superset/src/mdnsRegistry.ts)

- 新增內部常數:
  ```typescript
  const TTL_GRACE_MULTIPLIER = 3;          // RFC 6762 §10.1 建議
  const EXPIRY_TICK_MS = 5_000;            // 每 5 秒掃一次
  const TTL_DEFAULT_SECONDS = 120;         // 記錄沒帶 TTL 時的 fallback
  ```
- 新增 `private expiryTimer?: ReturnType<typeof setInterval>;` 與 `private now: () => number`(可注入 fake clock)。
- `start()` 啟動時設定 `expiryTimer = setInterval(() => this.expireStale(), EXPIRY_TICK_MS)`;`stop()` 清除。
- 新增 `private expireStale()`:
  - 走訪 `this.services`,若 `this.now() - s.lastSeen > (s.ttl || TTL_DEFAULT_SECONDS) * 1000 * TTL_GRACE_MULTIPLIER` → 從 Map 移除,排入 `pending` 等下次 `flushPending` 觸發 `removed` 事件。
- `handlePacket` 中,當 service 收到新封包時,除了更新 `addresses` / `txt` 等欄位,也要更新 `lastSeen = this.now()`(現有邏輯應該已有,但需確認)。

#### [MODIFY] [types.ts](file:///Users/bytedance/projects/superset/src/types.ts)

- `MdnsChange` 加上 `{ type: "expired"; service: MdnsService }` 變體 — 與 `removed` 區分:`removed` 是 transport 明確告知,`expired` 是 registry 自己判定的(監控用途)。
- 若使用者偏好簡化,亦可省略 `expired` 事件,只重用 `removed`。

### 建構子注入 (DI)

#### [MODIFY] [extension.ts](file:///Users/bytedance/projects/superset/src/extension.ts)

- `new MdnsRegistry(new MulticastDnsTransport())` 不變;registry 內部用 `Date.now` 即可。
- 測試環境用 `new MdnsRegistry(transport, { now: () => fakeNow })` 注入 fake clock — 需在 `MdnsRegistry` 建構子多接一個選項 `ClockSource = { now: () => number }`(預設 `Date.now`)。

---

### 測試 (Tests)

#### [MODIFY] [mdnsRegistry.test.ts](file:///Users/bytedance/projects/superset/test/mdnsRegistry.test.ts)

- 新增以下 case:
  - **Grace period 內收到新封包**:不過期
  - **超過 TTL × 3 grace period 沒新封包**:被移除,觸發 `removed` 事件
  - **沒帶 TTL 的 service**:fallback 到 `TTL_DEFAULT_SECONDS * 3`
  - **大量 service 中只有部分過期**:只觸發對應的 `removed` 事件,其他保留
  - **多 service 同時過期**:`removed` 事件批次觸發(coalesce),不重複發
  - **`stop()` 後 timer 清除**:確認 `clearInterval` 被呼叫(用 `vi.useFakeTimers()` 驗證)
  - **TTL 為 0 的 service**:`ttl === 0` 視為「未指定」,走 fallback
- 用 `vi.useFakeTimers()` 控制 fake clock;`MdnsRegistry` 建構子接 `{ now: () => fakeNow }` 讓測試決定當下時間。
- 不用真實 `setInterval` 等待 — 測試在 fake timer 環境下 `vi.advanceTimersByTime(EXPIRY_TICK_MS)` 觸發一次掃描,即可驗證整個流程。

#### [NEW] [mdnsRegistry.expiration.test.ts](file:///Users/bytedance/projects/superset/test/mdnsRegistry.expiration.test.ts)(可選)

- 純粹測 expiration 路徑,獨立檔案以便日後維護。
- 若既有 `mdnsRegistry.test.ts` 行數膨脹超過 ~400 行,再拆出去。

---

### 改進的「可觀察」指標

| 指標                                   | 改進前       | 改進後 (預期)         |
| -------------------------------------- | ------------ | --------------------- |
| mDNS 面板「殭屍服務」比例              | 高(只增不減) | 低(3× TTL 自動清)   |
| 新增測試 case 數                       | 0(此功能)    | 7+ 個                 |
| `MdnsRegistry` 公開 API 改動           | n/a          | 0(向後相容)          |
| `lastSeen` 寫入次數(每次 packet)       | 已存在       | 不變(沿用既有)        |

## 驗證計劃 (Verification Plan)

### 自動化測試

- 執行 `npm test`,所有既有 156 個 case 必須全綠。
- 新增 7+ 個 case,全綠。
- 用 `vi.useFakeTimers()` 確認 `setInterval` 行為,避免測試卡等真實時間。

### 手動驗證

- 在 mDNS 環境(同網段有 Bonjour / Avahi 服務的機器)啟動 Extension Development Host:
  - 觀察初始發現若干 service
  - 關閉其中一台機器的服務 / 拔網路線
  - 等候 `EXPIRY_TICK_MS` × 多次(實際 ~30 秒)
  - 確認該 service 從面板消失,並觸發 `removed` 事件(觀察 OutputChannel 診斷日誌)
- 確認「正在活動」的 service 不會被誤刪(持續收到 mDNS 封包 → `lastSeen` 持續更新 → 永遠不過期)。

### 邊界情境

- **快速切換網路**:從 Wi-Fi 切到 4G → `srcAddress` 變了,所有 service 的 `lastSeen` 不會自動更新 → 預期會在 grace period 內全部過期,然後被新網路的真實封包重新填入。可接受。
- **TTL 為 0 的封包**:fallback 到 `TTL_DEFAULT_SECONDS`(= 120s),最壞情況 6 分鐘才過期。可接受。

## 風險與緩解 (Risks & Mitigations)

| 風險                                       | 緩解                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| 過期太激進,正常服務被誤刪                 | grace period 用 3× TTL(寬鬆);測試覆蓋「持續收到封包」情境                            |
| 過期太寬鬆,殭屍服務累積                   | 提供 `EXPIRY_TICK_MS` 為常數,日後若要加快只需改一處                                  |
| Fake clock 與真實 `setInterval` 行為不一致 | `vi.useFakeTimers()` 是 vitest 官方 API,與 Node `setInterval` 語意對齊               |
| `MdnsRegistry` 建構子簽名變更破壞既有測試  | 新參數 `ClockSource` 是**選用**,既有 `new MdnsRegistry(transport)` 呼叫完全不變      |
| 過期事件洪流(同時 100 個 service 過期)    | `flushPending` 既有 coalesce 邏輯(同一 tick 內合併)剛好處理此情境                    |

## 預估工作量 (Effort Estimate)

- `MdnsRegistry` 新增 `expireStale()` + `setInterval` lifecycle:1 小時
- `MdnsRegistry` 建構子加 `ClockSource` 選項:15 分鐘
- `extension.ts` 改動:5 分鐘(呼叫端不變)
- 新增 7+ 個測試 case:1 小時
- 手動驗證(mDNS 環境):30 分鐘
- **總計:約 3 小時**

## 後續 (Follow-ups, 非本次範圍)

- 把 `ClockSource` 抽成獨立 `src/clock.ts`,讓 `topologyStore` 也能用同樣方式注入 fake clock(呼應 [2026-06-23-test-coverage-topology](2026-06-23-test-coverage-topology.md) 計畫)。
- 評估「mDNS 服務被刪除前,面板上閃爍 1 秒的視覺提示」是否值得做,降低使用者對「服務突然不見」的困惑。
- 與 [#2A Group metadata persistence](2026-06-23-feature-workspace-aware-group-suggestions.md) 的整合:過期 service 若屬於某個 auto-group,是否要把 group 也清掉?(目前 auto-group 邏輯是「cumulative」,不清)
