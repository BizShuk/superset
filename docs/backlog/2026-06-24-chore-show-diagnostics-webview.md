# `Superset: Show Diagnostics` 即時狀態面板 (Diagnostic Snapshot Webview)

> 提供一個命令 + Webview,在使用者的瀏覽器 panel 中即時顯示 Superset 內部各子系統的狀態快照(terminal 數、mDNS 服務數、topology 節點數、todo 進度、engines 版本等),並支援一鍵複製整段到剪貼簿,方便使用者貼到 GitHub issue 求助時附上完整 context。

## 為何要做 (Why)

- **現況的「除錯資訊取得成本」過高**:
    - `extension.ts` 內有 21 個 `log(` 呼叫(`Superset` OutputChannel 內),但**使用者拿不到這些 log 結構**:
        - 想看「為什麼 mDNS 面板沒顯示 X service」→ 要叫使用者「打開 Superset OutputChannel 找 `mdns.` 開頭的行」→ 不友善
        - 想看「我現在有幾台 PTY terminal、幾台一般 terminal」→ 沒有 API,只能從 panel UI 數
        - 想看「todo 統計」→ 同上,沒有 API
    - `superset.showLogs` 命令只是 `diag.show(true)`,把整個 channel 倒出來;沒有結構化整理
    - 沒有「即時」資訊:log channel 是時間序列,無法一眼看出「現在」狀態
- **典型的求助場景**:
    - 使用者開 GitHub issue 寫「我的 topology 面板空白,怎麼辦?」
    - 維護者只能要他「裝 Debug version」、「跑 `console.log`」、「貼 Superset log」— 高摩擦、低成功率
    - 有了 Diagnostic Webview:使用者按一個按鈕,維護者拿到**結構化 snapshot**,直接讀
- **低風險**:Webview 只是「讀」內部狀態並顯示,完全不改任何資料流,失敗也只影響輔助 UI。

## 使用者審查要求 (User Review Required)

> [!IMPORTANT]
>
> - **資訊敏感度**:`MdnsService` 內可能含 `srcAddress`(網卡 IP,等同本機網路拓跡);若使用者隱私敏感,可能要遮罩。
>     - 預設:**不遮罩** — `mDNS` 面板本來就顯示 IP,且只有本機可見
>     - 提供「Redact IPs」toggle 讓使用者自己決定(預設 off)
> - **Webview 的位置**:
>     - 預設:作為新 tab 在 editor area(用 `vscode.window.createWebviewPanel` + `viewColumn: ViewColumn.Beside`)
>     - 替代:作為 status bar 下拉(類似 `StatusBar` 點擊展開)— 工程成本較高
>     - 推薦 editor area tab:與既有 `OutputChannel` 開啟方式對稱
> - **要不要定期 auto-refresh**?
>     - 預設:不 auto-refresh,使用者按「Refresh」按鈕手動觸發(避免每 1 秒 rebuild webview 耗電)
>     - 替代:每 5 秒 auto-refresh — 工程簡單但使用者可能不想要
> - **是否要支援「Save snapshot to file」**(方便附件上傳 GitHub issue)?
>     - 預設:有,額外按鈕
>     - 副產物:同時是 `## Features` 區塊可勾選項

## 提議的變更 (Proposed Changes)

### 模組 (Module)

#### [NEW] [diagnostics.ts](file:///Users/bytedance/projects/superset/src/diagnostics.ts)

- 純函式模組(不依賴 vscode),負責把各個 store / registry 狀態彙整成 snapshot 物件:

    ```typescript
    export interface DiagnosticSnapshot {
        generatedAt: string; // ISO timestamp
        extension: {
            version: string;
            engines: { vscode: string; node: string };
            activationSessionId: string;
        };
        terminals: {
            total: number;
            ptyBacked: number;
            withUnseenOutput: number;
            groups: number;
        };
        mDNS: {
            serviceCount: number;
            oldestLastSeen: string | null; // 給人判斷 mDNS 是否還在動
        };
        topology: {
            nodeCount: number;
            lastScanAt: string | null;
        };
        todo: {
            total: number;
            completed: number;
            listOnly: number; // kind: "list" 節點(非勾選)
        };
        // ...etc
    }

    export function buildSnapshot(deps: {
        registry: TerminalRegistry;
        groupStore: GroupStore;
        mdnsRegistry: MdnsRegistry;
        topologyStore: TopologyStore;
        todoStore: TodoStore;
    }): DiagnosticSnapshot;
    ```

- 全部都是「讀」操作,副作用 0。

#### [NEW] [diagnosticWebview.ts](file:///Users/bytedance/projects/superset/src/diagnosticWebview.ts)

- vscode-bound 模組:管理 `WebviewPanel` 生命週期,呼叫 `buildSnapshot` 拿資料,渲染成簡單的 HTML(webview 不需要 framework,用模板字串即可)。
- 提供 `refresh()` 按鈕的 message handler。
- 提供 `copy to clipboard` 按鈕:`vscode.env.clipboard.writeText(JSON.stringify(snapshot, null, 2))`。
- 提供 `save to file` 按鈕:`vscode.window.showSaveDialog` + `writeFile`。

### 命令 (Commands)

#### [MODIFY] [package.json](file:///Users/bytedance/projects/superset/package.json)

- 在 `contributes.commands` 加:

    ```json
    {
        "command": "superset.showDiagnostics",
        "title": "Superset: Show Diagnostics",
        "category": "Superset",
        "icon": "$(info)"
    }
    ```

- 在 `contributes.menus.commandPalette` 加,讓命令可在 `Ctrl+Shift+P` 觸發(預設即可,不用顯式列)。

#### [MODIFY] [extension.ts](file:///Users/bytedance/projects/superset/src/extension.ts)

- 在 `activate()` 內:

    ```typescript
    const diagnosticView = new DiagnosticWebviewProvider({
        registry,
        groupStore,
        mdnsRegistry,
        topologyStore,
        todoStore
    });
    subscriptions.push(
        vscode.commands.registerCommand("superset.showDiagnostics", () =>
            diagnosticView.show()
        )
    );
    subscriptions.push({ dispose: () => diagnosticView.dispose() });
    ```

---

### 測試 (Tests)

#### [NEW] [diagnostics.test.ts](file:///Users/bytedance/projects/superset/test/diagnostics.test.ts)

- 純函式 `buildSnapshot` 測試:
    - 各個 store 都是空時,回傳的 `total: 0`、`completed: 0` 等
    - 加 1 個 terminal → `terminals.total: 1`
    - 1 個 mDNS service + 1 個 topology node → 對應計數正確
    - `engines.vscode` 反映 `package.json` 的當前值
    - `generatedAt` 是合法 ISO timestamp(可 parse)
- 不需要 mock vscode。

#### [NEW] [diagnosticWebview.test.ts](file:///Users/bytedance/projects/superset/test/diagnosticWebview.test.ts)

- 與 `todoTreeProvider.test.ts` 同樣的 `vi.mock("vscode")` 模式:
    - `show()` 後 `createWebviewPanel` 被呼叫一次
    - `dispose()` 後 panel 被 dispose
    - `refresh()` 後 HTML 內含當前 snapshot 資料
    - 點 webview 內的「Copy to clipboard」按鈕 → `clipboard.writeText` 被呼叫,參數是合法 JSON

---

### 改進的「可觀察」指標

| 指標                              | 改進前                             | 改進後(預期)        |
| --------------------------------- | ---------------------------------- | ------------------- |
| 使用者取得診斷資訊的步驟數        | 5+ 步(開 Output → 找關鍵行 → copy) | 1 步(命令 → 點按鈕) |
| 維護者收到 issue 含診斷資訊的比例 | 低                                 | 高                  |
| Snapshot 結構化程度               | 無(自由文字)                       | JSON,有 schema      |

## 驗證計劃 (Verification Plan)

### 自動化測試

- 執行 `npm test`,所有既有 156 個 case 必須全綠。
- 新增 `diagnostics.test.ts` 約 6 個 case,`diagnosticWebview.test.ts` 約 4 個 case,全綠。

### 手動驗證

- 啟動 Extension Development Host:
    - 按 `Ctrl+Shift+P` → `Superset: Show Diagnostics` → 新 webview tab 出現
    - 顯示所有子系統的即時計數
    - 開 1 個 terminal → 按 Refresh → 計數 +1
    - 按 Copy to clipboard → 剪貼簿有 JSON
    - 按 Save to file → 存到指定路徑
    - 關閉 webview → 內部 `panel` 變 undefined,下次 `show()` 重新建立

## 風險與緩解 (Risks & Mitigations)

| 風險                                  | 緩解                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Snapshot 包含敏感資訊(IP、session id) | 文件明確標註「別貼公開 issue」;提供 Redact toggle                       |
| `buildSnapshot` 與各 store 介面耦合   | 用最小依賴(只呼叫 getter),不動 store 內部狀態                           |
| Webview 佔記憶體                      | 單一 panel 共享,關閉即釋放;沒有定時 refresh 故無背景負擔                |
| 既有命令 `superset.showLogs` 變得冗餘 | 保留(`showLogs` 給「看時間序列 log」,本 webview 給「看即時狀態」)— 互補 |

## 預估工作量 (Effort Estimate)

- `diagnostics.ts` 純函式:45 分鐘
- `diagnosticWebview.ts` vscode-bound:1.5 小時
- 命令註冊 + menu 設定:15 分鐘
- 純函式測試 6 個 case:30 分鐘
- Webview 測試 4 個 case(含 vscode mock):30 分鐘
- 手動驗證:30 分鐘
- **總計:約 4 小時**

## 後續 (Follow-ups, 非本次範圍)

- **Webview → Markdown report**:把 snapshot 自動轉成 Markdown 段落,含版本、計數、已知問題清單 — 使用者連 issue 模板都免寫
- **Diagnostics → telemetry**(opt-in):使用者同意後,把 snapshot 匿名上傳到 Sentry 風格的服務,自動偵測 regression
- **「Reset all caches」按鈕嵌進 Diagnostic Webview**:本 plan 不做,但與 `## Features` 區塊的「`Superset: Reset All Caches`」自然整合
- **Diagnostic 加上「健康度評分」**:把 `mDNS` 沒新封包 > 5 分鐘、`terminals` 全 unseen > 10 分鐘等條件加總,給 0-100 分,給使用者「現在狀態好不好」的快速判讀
