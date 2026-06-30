# VSCode 版本基線對齊 (VSCode Baseline Alignment)

> 把 `package.json` 的 `engines.vscode` 與 `@types/vscode`、以及程式碼內針對 1.85 / 1.90+ 的條件分支,統一對齊到**實際支援的最低 VSCode 版本**,並把 Node 引擎也顯式列出。

## 為何要做 (Why)

- **現況的版本不一致**:
  - `package.json` 的 `engines.vscode` 鎖 `^1.85.0`(2025-01 釋出)
  - `package.json` 的 `@types/vscode` 也鎖 `^1.85.0`
  - 但**實際安裝**的 `@types/vscode` 為 `1.125.0`(透過 `^1.85.0` 範圍抓到最新)— 開發者本機 build 拿到的型別比 marketplace 預期的新很多。
  - 程式碼內已有「VSCode 1.90+ 才有」的行為預期:`highlightPresenter.ts:38` 與 `extension.ts:299-300` 明確指出「1.85 還可寫,1.90+ throw,需要 fallback 邏輯」。
  - `extension.ts:485` 使用 `vscode.TabInputTerminal`(VSCode 1.86 引入)— 1.85 上會 type error / runtime undefined。
- **結果**:
  - 開發者本機 build 通過 → 推到 marketplace → 1.85-1.89 的使用者安裝後壞掉。
  - 程式碼為了「支援舊版」維護了 `nameWriteSupported` 的 runtime 探測(`highlightPresenter.ts:75-92`),但因為最低支援版本其實已經是 1.93+,這段 fallback 邏輯是**死代碼**。
- **為何到現在還沒人 bump**:歷史遺留 — `engines` 從初版就寫 1.85,沒人主動更新。
- **本 plan 是一次性對齊**,之後的 plan 都可以假設「最低支援版本 = 1.93」。

## 使用者審查要求 (User Review Required)

> [!IMPORTANT]
> - **Bump `engines.vscode` 到 `^1.93.0` 會擋掉 1.85-1.92 的使用者**(marketplace 的 VSCode Marketplace 篩選)。需要使用者確認:
>   - 目標使用者群是否都跑 1.93+?(截至 2026-06,VSCode 1.93 釋出已久,主流使用者多半已升級)
>   - 是否要 bump 到更新的版本(如 `^1.95.0`)?若要,plan 範圍擴大。
> - 預設採用 `^1.93.0`(最小必要改動)。
> - **`@types/vscode` 鎖版**策略:
>   - 預設:用 `~1.93.0`(只接受 patch 更新,避免日後 minor 版又引入未驗證的型別)
>   - 替代:用 `^1.93.0`(允許 1.x minor 更新,可能引入新功能型別但 build 仍過)
>   - 推薦 `~1.93.0`:更保守,降低「型別偷偷變了但 runtime 還在 1.93」的風險。
> - **是否要順便加 `engines.node`?**
>   - 預設:加 `"engines.node": ">=20.0.0"`,因為:
>     - VSCode 1.93+ 自帶 Node 20.x runtime
>     - `node-pty` prebuild 至少需要 Node 18,但 20 已是 LTS
>     - 顯式聲明降低貢獻者環境不一致問題
>   - 替代:不加(保持現狀)。推薦加上。

## 提議的變更 (Proposed Changes)

### `package.json` (Manifest)

#### [MODIFY] [package.json](file:///Users/bytedance/projects/superset/package.json)

```diff
 "engines": {
-    "vscode": "^1.85.0"
+    "vscode": "^1.93.0",
+    "node": ">=20.0.0"
 },
 ...
 "devDependencies": {
     ...
-    "@types/vscode": "^1.85.0",
+    "@types/vscode": "~1.93.0",
     ...
 }
```

### 型別 / API 驗證 (Type Audit)

#### [NEW] [docs/api-baseline.md](file:///Users/bytedance/projects/superset/docs/api-baseline.md)

- 列出 extension 用到的每個 `vscode.*` API,標註「最低支援版本」,作為未來 bump 對齊的查核表。
- 範例:

  | API                       | 最低 VSCode 版本 | 引入 commit / 來源 |
  | ------------------------- | ---------------- | ------------------ |
  | `vscode.Terminal.name` (getter-only) | 1.90    | highlightPresenter 註解   |
  | `vscode.TabInputTerminal` | 1.86             | extension.ts:485           |
  | `vscode.RelativePattern`  | 1.64             | extension.ts:281           |
  | `vscode.Pseudoterminal`   | 1.74             | extension.ts             |
  | `vscode.TreeDragAndDropController` | 1.45  | extension.ts             |
  | `vscode.window.onDidStartTerminalShellExecution` | 1.85 | extension.ts |

- 維護責任:每次 bump `engines.vscode` 時,順便核對這份表;新 API 加入時順便標註。

### 移除死代碼 (Dead Code Removal)

#### [MODIFY] [highlightPresenter.ts](file:///Users/bytedance/projects/superset/src/highlightPresenter.ts)

- 移除 `nameWriteSupported` 旗標與相關 fallback 邏輯(行 29、38-42、75-92)。
- 由於 1.90+ 永遠是 getter-only,`setTerminalName` callback **直接 throw 就好** — 但既然 throw 是事實,就不需要在 caller(extension.ts:298-300)做 try-catch 探測,直接讓 presenter 內部「如果能寫就寫、不能就 log」即可。
- 簡化後 `applyPrefix` 約少 15 行。
- **測試更新**:移除 `degrades silently when terminal.name setter throws` 測試的「runtime 探測」部分,改為「直接驗證 callback throw 時不 crash、log 仍觸發、status bar 仍更新」。

### 文件 (Documentation)

#### [MODIFY] [CLAUDE.md](file:///Users/bytedance/projects/superset/CLAUDE.md)

- 第 33 行的 `> engines.vscode 為 ^1.85.0,需要 Shell Integration API 穩定後的版本。低於 1.85 收不到 shell execution 事件` 改為:
  - `> engines.vscode 為 ^1.93.0,需要 Shell Integration API 與 TabInputTerminal 穩定後的版本。1.90 之前 Terminal.name 還可寫,之後變 getter-only — 我們對齊到 1.93+ 的語意。`

#### [MODIFY] [README.md](file:///Users/bytedance/projects/superset/README.md)

- 找到「Requirements」或「Compatibility」段落,加上:
  - `VSCode 1.93+`
  - `Node 20+`(開發環境)

---

## 驗證計劃 (Verification Plan)

### 自動化測試

- 執行 `npm test`,所有既有 156 個 case 必須全綠。
- 移除 `nameWriteSupported` 探測邏輯後,既有 1 個依賴此行為的測試要更新,但斷言意圖保留。
- `npm run watch` 確認 TypeScript 編譯通過(鎖版後 `@types/vscode 1.93` 內沒有移除的 API)。

### 手動驗證

- 在 VSCode 1.93 與 1.95 各別啟動 Extension Development Host:
  - 確認 `Terminal.name` 寫入行為如預期(getter-only throw,presenter 內部不 crash)。
  - 確認 `vscode.TabInputTerminal` 實例判斷無誤。
  - 確認 TUI 偵測、status bar notification, panel focus, filter button 全部正常。

### Marketplace 驗證(發版前)

- `npx @vscode/vsce package` 確認 build 通過。
- 上傳到 marketplace 後,從 1.85 試裝,確認 marketplace 拒絕(版本不符)。

## 風險與緩解 (Risks & Mitigations)

| 風險                                       | 緩解                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| Bump 後 1.85-1.92 使用者無法更新擴充     | 在 release notes / CHANGELOG 明確標註「Drop VSCode < 1.93 support」;1 年緩衝期應該足夠大部分使用者升級 |
| `@types/vscode 1.93` 缺少某些新 API       | 列出所有 extension 用到的 API,在表中驗證;若發現缺漏,改用 `~1.95.0`              |
| 移除 `nameWriteSupported` 後,fallback 失效 | 既有 fallback 邏輯只為「探測」存在,實際行為(throw → log + 繼續)保留;只是把「永遠 throw」的事實寫死 |
| `engines.node` 影響 contrib workflow       | 加上後 contrib PR 會在「用 Node 18」時報錯;可在 CONTRIBUTING.md 提示             |

## 預估工作量 (Effort Estimate)

- 列出 API baseline 表:30 分鐘
- 改 `package.json`:5 分鐘
- 改 `highlightPresenter.ts`(移除 fallback)+ 改 1 個測試:30 分鐘
- 改 `CLAUDE.md` / `README.md`:15 分鐘
- 手動驗證(1.93 與 1.95):30 分鐘
- **總計:約 2 小時**

## 後續 (Follow-ups, 非本次範圍)

- **CI bump check**:加 GitHub Action 在每次 PR 檢查「所用 API 是否都在 `engines.vscode` 標的版本內提供」(用 `vscode-test` 或 `engines-check` 工具)。
- **CHANGELOG.md**:補上從 0.0.1 到 0.0.2 的版本歷史(目前沒有,首次 release 就已 bump 0.0.2)。
- **@types/vscode 自動更新策略**:每季 review `engines.vscode` 是否需要 bump,跟隨 VSCode stable 釋出週期。
