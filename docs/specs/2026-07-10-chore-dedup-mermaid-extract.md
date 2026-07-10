# 2026-07-10 — Dedup Shims, Link Utils; Extract Mermaid Subfolder

> 已實作 (implemented)。純結構性重構,零行為變更 — `577/577` 測試全綠,`tsc` 編譯通過。版本 `0.10.1` → `0.10.2` (patch)。

## 背景 (Background)

對 `src/` (13,641 行) 與 `test/` (10,690 行) 做可合併相似物件的盤點,找出 4 組結構性重複並逐一合併,讓程式碼更易理解、同步風險歸零。盤點過程亦標記了「看似重複實則不然」、刻意保留的項目(見末段)。

## 變更 (Changes)

### 1. `buildFeatureContext()` ×6 份逐字重複 → 1 份共用 helper

**問題**:`src/{todo,mdns,terminals,topology,projects,projectsTodo}/plugin.ts` 六個 plugin shim 各自有一份幾乎逐字相同的 `buildFeatureContext()`,差異只有 `statusBar`(`terminals` 用真實 item,其餘五份用 `{} as vscode.StatusBarItem` stub)。註解也大同小異。

**做法**:新增 `src/plugin/featureContext.ts` 暴露 `createFeatureContext(pCtx, { statusBar })`,把訂閱陣列 (subscriptions array) 的 `push` 攔截轉送邏輯只寫一次。`src/plugin/index.ts` barrel 加 `export { createFeatureContext, type CreateFeatureContextOptions }`。六個 shim 各自縮成 ~15 行,只保留 `activate()` 呼叫與 `__<name>Handle` 橋接。

**結果**:六檔共淨減 ~220 行;新增 1 helper 檔。

### 2. 6 份相同的 plugin contract test → 1 份參數化 helper

**問題**:`test/{todoPlugin,mdnsPlugin,terminalsPlugin,topologyPlugin,projectsPlugin,todoPreviewPlugin}.test.ts` 六檔各自是同一份「id/name / 無 markdown hook / 有 `deactivate`」三案例,只有 plugin 名與 import 不同。

**做法**:新增 `test/pluginContract.shared.ts` 的 `assertPluginContract(plugin, { id, name, markdownHook, deactivate })`。`markdownHook: "absent" | "function"` 區分 panel 類(無 hook)與 `todoPreview`(有 hook);`deactivate: "present" | "absent"` 區分有 `deactivate` body 的五個 panel shim 與省略它的 preview-only plugin。各檔縮成 mock + dynamic import + 一行呼叫;`treePreviewPlugin.test.ts` 不在此列(它有真實 fence 行為測試)。

**踩坑**:`todoPreviewPlugin` 與 `treePreviewPlugin` **沒有** `deactivate`(preview-only plugin 刻意省略),最初版本的 helper 強制 `deactivate` 必為 function 而誤殺 → 加 `deactivate: "absent"` 分支修正。

**結果**:測試案例數 588 → 577(每檔 3 case 合併為 1 個 `it`);斷言內容不變。

### 3. `extractLink` / `resolveTodoLink` / `ResolvedLink` / `cleanLabelText` ×3 處 → 1 處 source of truth

**問題**:同一邏輯在 3 處,且 `todoEngine/linkUtils.ts` 註解明說「duplicate is intentional,待 refactor 後 panel-side 副本可移除」:

| 位置                              | 內容                                          |
| --------------------------------- | --------------------------------------------- |
| `src/todo/todoTreeProvider.ts`    | `extractLink` + `cleanLabelText` + `ResolvedLink` + `resolveTodoLink`(源頭) |
| `src/todoEngine/linkUtils.ts`     | `extractLink` 鏡像副本 + `formatLinkCopyText` |
| `src/todoEngine/commandFactory.ts`| `ResolvedLink` 介面 + `resolveTodoLinkFactory` 副本 |

**做法**:`src/todoEngine/linkUtils.ts` 成為唯一 source,新增 `cleanLabelText` / `ResolvedLink` / `resolveTodoLink` 三個定義(採 todoTreeProvider 版實作 — 有 `test/todoTreeProvider.test.ts` 覆蓋)。`todoTreeProvider.ts` 刪除本地定義,改 `import` 後 re-export(保 backward-compat 給仍從該模組 import 的測試)。`commandFactory.ts` 刪 `resolveTodoLinkFactory` + 本地 `ResolvedLink` 介面,改 `import resolveTodoLink`。生產端 consumer 直指 linkUtils:`todo/index.ts`、`projectsTodo/index.ts`、`projectsTodoTreeProvider.ts`(後者仍從 todoTreeProvider 拿 `filterCompleted` / `applyPriorityFilter`,分開 import)。

**實作差異說明**:兩份 `resolveTodoLink` 細節不同(`substring(7)` vs `slice(len)`、`path.isAbsolute` vs `startsWith("/")`),但語意等價;採 todoTreeProvider 版為準。`extractLink` 的 `markdownMatch[1].trim()` vs `[1]!.trim()` 亦語意等價,採 linkUtils 版。

**順帶修正**:`projectsTodo/index.ts` 的 `extractLink` / `resolveTodoLink` 改從 `../todoEngine/linkUtils` import,不再從 `../todo/todoTreeProvider` 拿 → 移除一條 link-helper 的 `projectsTodo → todo` 反向依賴。注意:`projectsTodoTreeProvider.ts` 仍 import `filterCompleted` / `applyPriorityFilter` from `todo/todoTreeProvider`(獨立重構範疇,本次未碰)。

### 4. mermaid 4 檔抽出到 `src/mermaid/`

**問題**:`src/terminals/mermaid{LineBuffer,LinkProvider,PreviewCommand,Trigger}.ts`(~644 行)是同一 feature 的四個部分,卻散落在 `terminals/` 而非自己的子模組,與 `todo/`、`mdns/`、`topology/` 的 feature-as-folder 慣例不一致。

**做法**:`git mv` 保留歷史,四檔移到 `src/mermaid/`(檔名不變,降低變更面)。新建 `src/mermaid/index.ts` barrel re-export 全部 public surface(`MermaidLineBuffer` / `MermaidTerminalLinkProvider` + 3 介面 / `registerMermaidPreviewCommand` + `runMermaidPreview` + `MermaidPreviewOptions` + `__test_only__` / `findFirstMermaidMatch` + `findAllMermaidMatches` + `MermaidMatch`)。修 5 處 import:`src/terminals/index.ts`(3 個 `./mermaid*` → `../mermaid/mermaid*`)+ 4 測試檔(`sed` 批次 `src/terminals/mermaid` → `src/mermaid/mermaid`)。

**踩坑**:兩個 mermaid 檔原本 `import type { TerminalHandle } from "./types"`(指 `src/terminals/types.ts`),搬移後 `./types` 解析到不存在的 `src/mermaid/types.ts` → 改 `import type { TerminalHandle } from "../terminals/types"`。`TerminalHandle` 是 terminal domain 型別,mermaid 為其子功能,反向依賴方向正確。

**結果**:git 偵測為 rename(`R` 標記),歷史連續;`src/terminals/` 不再混入 mermaid 實作。

## 整體驗證 (Verification)

- `npx tsc --noEmit`:exit 0
- `npm test`:577 passed (61 test files),全綠
- `git diff --stat`:28 檔,淨 −235 行 (−439/+204)
- 版本:`0.10.1` → `0.10.2`(patch,純重構)

## 刻意未動 (Intentionally Not Touched)

盤點時以下項目「看似重複」但實為 Stage 2–6 的 SRP / DI 遷移成果或過渡態,合併會倒退或破壞後續路線:

- `src/todo/todoBlockOps` / `todoMoveOps` / `todoMutations` / `todoSectionOps` / `planActions` — 五檔雖都吃 `TodoStoreContext`,但各自是不同 mutation 領域,是 Stage 2 的 SRP 拆分成果。
- `src/crossModuleState/{diagnosticChannel,pluginManager,terminalSpawner}.ts` — 三個 setter/getter pair 結構相同,但註解標明是 Stage 6 DI migration 的過渡態,刻意分檔。
- `projectsTodoTreeProvider.ts` 從 `todo/todoTreeProvider` import `filterCompleted` / `applyPriorityFilter` — 另一條 `projectsTodo → todo` 依賴,屬獨立重構範疇,本次僅處理 link-helper 部分。

## 相關 (References)

- `CLAUDE.md`「Feature Modules」表新增 `src/mermaid/` 列;「Plugin Framework」表新增 `plugin/featureContext.ts` 列;「跨 feature 共用」段補 link-utils source of truth 說明;「`src/terminals/` 內部拆檔」段補 mermaid 抽出註解。
- 與既有 `docs/specs/2026-07-08-chore-consistency-redundancy-scalability.md`、`2026-07-09-code-quality-review.md` 同屬 chore 重構系列。
