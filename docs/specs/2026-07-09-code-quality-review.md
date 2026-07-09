# Code Quality Review — 結構 / 一致性 / SSSR

> 體檢日期 2026-07-09。本 plan 鎖定 `2026-07-08-chore-consistency-redundancy-scalability.md` 尚未覆蓋的兩個維度:**SSSR (Single File Single Responsibility)** 與**不合理結構 (例如 1k+ 行 mega-file、production 程式碼的 `console.log`、遺留 `@deprecated`)**。既有的重複鏡像與檔案命名 (Stage 1–5) 不在本 plan 重述;本 plan 補上結構性硬傷的修補路徑。

## Context (為何做這一輪)

既有 plan 已盤點「重複代碼 / 命名 / 可擴充性」,留了 Stage 4 (plugin shim factory)、Stage 5 (todo 引擎合併) 與 Stage 6 (FeatureContext 退場) 給後續 PR 走完整週期。本輪在**結構 (structure)** 維度加做兩件事:

1. **SSSR 紅線**:找出違反「單一檔案、單一職責」的最大檔案與最具擴充瓶頸的混雜點,給出**單點、純 extract、不動 runtime 行為**的修補計畫。
2. **不合理結構 / 衛生**:找出 production 程式碼的 `console.log` / 死碼 / 遺留 `@deprecated` re-export / 缺漏的 `.vscodeignore` / 沒人維護的 `for_loop.sh` 等雜訊。

修復順序採「**先低風險、後高重構**」:本 plan 的所有 stage 都是**純檔案結構或純文件**變更,不會動 runtime 邏輯;任何 runtime 行為改動另開 plan。

---

## 盤點事實 (Verified, 2026-07-09)

```text
$ wc -l src/todo/todoStore.ts src/todo/todoTreeProvider.ts \
        src/projectsTodo/index.ts src/todo/index.ts \
        src/globalCommandsPlugin.ts src/terminals/index.ts \
        src/mdns/mdnsRegistry.ts
   1031 src/todo/todoStore.ts
    693 src/todo/todoTreeProvider.ts
    572 src/projectsTodo/index.ts
    532 src/todo/index.ts
    405 src/globalCommandsPlugin.ts
    273 src/terminals/index.ts
    252 src/mdns/mdnsRegistry.ts

$ grep -c registerCommand src/todo/index.ts src/projectsTodo/index.ts \
                           src/terminals/commands.ts src/mdns/index.ts
   22 src/todo/index.ts
   20 src/projectsTodo/index.ts
   10 src/terminals/commands.ts (含 jumpToTerminal 一條)
    4 src/mdns/index.ts

$ grep -n "console\." src/extension.ts src/globalCommandsPlugin.ts \
                       src/mdns/mdnsTransport.ts
src/extension.ts:33:    console.log("[superset] activated");
src/extension.ts:39:        console.log(`[superset] ${msg}`);
src/globalCommandsPlugin.ts:400:        console.error(`[superset] spawnRunTerminal failed ...`);
src/mdns/mdnsTransport.ts:82:            console.error(`[mdns transport] error: ${err.message}`);

$ grep -n "@deprecated" src/ -r --include="*.ts"
src/treePreview/plugin.ts:73: * @deprecated Prefer the `treePreviewPlugin` adapter ...

$ wc -l .vscodeignore
       5 .vscodeignore

$ ls scripts/
for_loop.sh
```

---

## Stage A — `todoStore.ts` (1031 行) 拆檔 (P1,半天)

### A.1 當前問題

`src/todo/todoStore.ts` 是 SSSR 紅線最大違規者 — 1031 行,承載 11 個獨立業務方法 + 9 個 module-level 純函式:

| 方法 (line)                            | 職責                       | 內聯依賴                                |
| -------------------------------------- | -------------------------- | --------------------------------------- |
| `toggle` (89)                          | 勾選 toggle                | `TAGS_RE` / `parseTagsFromLine` / `applyArchiveOrComplete` / `insertBlockIntoArchive` / `ensureArchiveIsLastSection` |
| `updatePriority` (147)                 | 設定 priority              | (純 regex)                              |
| `addTodo` / `applyAddTodo` (175/184)   | 新增 todo                  | (純 line 搜尋)                          |
| `moveTodo` (291)                       | 移動 todo                  | `findSectionNameOfLine` 的鏡像邏輯       |
| `archiveTodo` (476)                    | archive 單一               | `applyArchiveOrComplete` / `insertBlockIntoArchive` |
| `rollbackTodo` (493)                   | 復原 archive               | `findSectionNameOfLine` 鏡像 + insert 邏輯鏡像 |
| `archiveSection` (652)                 | 整段 archive               | `findSectionBlockEnd` / `findArchiveHeadingIndex` / `stripTrailingBlank` / `fixAdjacentHeadings` |
| `unarchiveSection` (699)               | 整段 unarchive             | 同上                                    |
| `deleteSection` (727)                  | 刪 section                 | (純 line 搜尋)                          |
| `updateText` (779)                     | 改文字                     | (純 regex)                              |
| `deleteTodo` (797)                     | 刪 todo                    | (純 indent 計算)                        |

加上 9 個檔尾 module-level 純函式 (`findSectionBlockEnd` / `findArchiveHeadingIndex` / `stripTrailingBlank` / `fixAdjacentHeadings` / `findSectionNameOfLine` / `getFormattedDateTime` / `ensureArchiveIsLastSection` / `applyArchiveOrComplete` / `insertBlockIntoArchive`),總行數破千、單檔承載 20 個獨立關注點。

CLAUDE.md 描述:「`src/todo/` 從 661 行單檔拆為 SRP-對齊的三層 (parser / repository / store)」,但 Stage 2 拆出 parser / repository 後,**剩餘的 `apply*` 系列純函式與 11 個業務方法沒跟著拆**。Stage 2 是 de-risk 的最小動作,本 plan 是它的後續收尾。

### A.2 目標形狀

```text
src/todo/
├── parser.ts              (既有 — 純 Markdown → AST)
├── repository.ts          (既有 — 唯一接觸 fs/promises)
├── todoStore.ts           (縮小為純 state + observer;委派給下面 3 個)
├── plansSource.ts         (既有)
├── todoMutations.ts       (新 — toggle / updatePriority / updateText / deleteTodo 純函式簽章)
├── todoSectionOps.ts      (新 — archiveSection / unarchiveSection / deleteSection 純函式簽章)
├── todoMoveOps.ts         (新 — moveTodo / addTodo / applyAddTodo / archiveTodo / rollbackTodo 純函式簽章)
├── todoBlockOps.ts        (新 — applyArchiveOrComplete / insertBlockIntoArchive / findSectionBlockEnd / findArchiveHeadingIndex / stripTrailingBlank / fixAdjacentHeadings / findSectionNameOfLine / ensureArchiveIsLastSection / getFormattedDateTime 共 9 個純函式)
└── types.ts               (既有)
```

`todoStore.ts` 縮為 ~250 行:`items` / `planItems` 狀態 + `load` / `onDidChange` / `emit` / `writeAndLoad` 骨架,11 個業務方法變成 4 行委派:

```ts
async toggle(item: TodoItem): Promise<void> {
  return toggleTodo(this, item);
}
```

### A.3 風險與撤銷策略

- **既有 23 個 test (CLAUDE.md 表格)** 全黑箱,行為不變 → 23/23 全綠
- 若有任何 regression,`git revert` 即可 — 純檔案結構變更,沒動 logic
- `todoStore.ts` 留 `import` 全部 re-export 給既有消費端 (`index.ts` / `todoTreeProvider.ts` / `projectsTodoStore.ts`) 維持介面零變化

### A.4 驗證

- `wc -l src/todo/todoStore.ts` ≤ 280 行
- 新檔 3 個,各 ≤ 250 行
- `npm test` 23 個 `todoStore.test.ts` + 全部既有測試 0 修改即全綠

---

## Stage B — `globalCommandsPlugin.ts` (405 行) 拆檔 (P1,1 hr)

### B.1 當前問題

| 函式 (line)                                          | 職責                              | 內聯依賴                                       |
| ---------------------------------------------------- | --------------------------------- | ---------------------------------------------- |
| `setDiagnosticChannel` (27) / `setPluginManager` (36) | module-level mutable state setter | (副作用)                                       |
| `superset.resetCaches` (45)                          | 對話框 + 清 state + `managerRef.resetAll` | `collectSupersetKeys` / `managerRef`    |
| `superset.focusView` (70)                            | 切到 terminals view               | (純 executeCommand)                            |
| `superset.focusOverallView` (84)                     | 切到 overall view                 | (純 executeCommand)                            |
| `superset.showLogs` (97)                             | 顯示 OutputChannel                | `diagnosticChannel`                            |
| `superset.focusPanel` (103)                          | 輪詢 panel 第一個可見 view         | (純 executeCommand)                            |
| `superset.installDefaultTools` (141)                 | `go install` pm2 + skills         | `spawnRunTerminal`                             |
| `superset.skillInstall` (192)                        | InputBox + `skills add <repo>`    | `spawnRunTerminal`                             |
| `superset.installIgnoreTemplate` (236)               | 寫 ignore 檔到 workspace          | `fs` / `path` / `spawnRunTerminal` / `quoteShellArg` |
| `spawnRunTerminal` (378)                             | PTY-backed 終端機 + sendText      | `getTerminalSpawner` / `vscode.window.*`       |
| `quoteShellArg` (319)                                | shell 引號 escape                 | (純)                                           |

11 個獨立關注點混在一個檔。`installDefaultTools` / `skillInstall` / `installIgnoreTemplate` 屬於「install commands」一類,`resetCaches` / `focusView` / `focusOverallView` / `showLogs` / `focusPanel` 屬於「chrome commands」一類 — 兩個 category 概念上分開。

### B.2 目標形狀

```text
src/
├── globalCommandsPlugin.ts   (縮小為 orchestration — 8 個 registerCommand + 委派)
├── spawnRunTerminal.ts       (新 — 抽出 spawnRunTerminal + SpawnRunTerminalOptions + quoteShellArg)
├── installCommands.ts        (新 — installDefaultTools + skillInstall + installIgnoreTemplate)
└── ...                       
```

| 抽出檔              | 行數目標 | 內容                                                                 |
| ------------------- | -------- | -------------------------------------------------------------------- |
| `spawnRunTerminal.ts` | ~100    | `spawnRunTerminal` + `quoteShellArg` + `SpawnRunTerminalOptions`      |
| `installCommands.ts`  | ~200    | `installDefaultTools` / `skillInstall` / `installIgnoreTemplate` 三條命令 + 共用 InputBox/確認邏輯 |
| `globalCommandsPlugin.ts` | ~120 | `resetCaches` / `focusView` / `focusOverallView` / `showLogs` / `focusPanel` 5 條 chrome 命令 + module-level setters + 委派 `installCommands` |

### B.3 風險與撤銷策略

- `setDiagnosticChannel` / `setPluginManager` 仍留在 `globalCommandsPlugin.ts`,因為 `extension.ts` 在 Stage 6 之前要繼續 import
- `installCommands.ts` 從 `pCtx` 接收 `extensionUri` / `workspaceFolder` / `log` / `getTerminalSpawner`,不再依賴 `setTerminalSpawner` 模組級別的 mutable state — 若 install commands 改用 DI 後即可讓 `installCommands.ts` 完全 unit-testable (但本 stage 不做,留給後續 plan)
- 既有 `test/installCommands.test.ts` (5 個 case) 不改任何一行即全綠

### B.4 驗證

- `wc -l src/globalCommandsPlugin.ts` ≤ 130 行
- 新檔 2 個,各 ≤ 220 行
- `npm test` `installCommands.test.ts` 5/5 + `pluginManager.test.ts` 7/7 全綠

---

## Stage C — `terminals/index.ts` (273 行) `decideAutoReplace` / lifecycle 切出 (P2,2 hr,獨立 plan)

### C.1 當前問題

`src/terminals/index.ts` 雖然比 Stage A/B 小,但 273 行內承載 7 個關注點,且 `onDidOpenTerminal` 內聯 50 行的 PTY 替換決策 (line 126–177) 是 CLAUDE.md §「Stage 4 (terminals)」明確點名的「風險高」目標。原本 Stage 4 為了 de-risk 沒抽,本 plan 在 Stage A/B 落地後,把這塊切出。

| 函式 (line)                                                | 職責                              |
| ---------------------------------------------------------- | --------------------------------- |
| `onDidOpenTerminal` 內聯 50 行 (126–177)                    | PTY 自動替換決策 + dispose race   |
| `onDidCloseTerminal` (179)                                  | registry remove                   |
| `onDidChangeActiveTerminal` (183)                          | tracker 同步 + clearUnseen         |
| `onDidChangeActiveTextEditor` (192)                        | 50 行 tab/editor focus 切換邏輯    |
| `setTerminalSpawner` / 預載 (122)                          | 跨模組 bridge                     |
| `OutputWatcher` start (101)                                | Shell integration fallback        |
| `commands.ts` 註冊 (231)                                  | terminal + group commands          |
| `disposables` 收集 (247)                                   | dispose 鏈                         |

### C.2 目標形狀

本 stage **不**抽 coordinator,只把「onDidOpenTerminal 內聯 50 行」抽成獨立純函式 `installAutoPtyReplacer(deps)`,並把「onDidChangeActiveTextEditor 50 行」抽成 `installEditorFocusBridge(deps)`。兩者返回 `vscode.Disposable`,由 `index.ts` 收集。

`terminals/lifecycle.ts` (新) ~120 行,承載 2 個 `install*` 函式,無 `vscode` 外其它 import;`index.ts` 縮為 ~180 行,純組裝。

### C.3 風險與撤銷策略

- 既有的 `autoReplace.test.ts` (11 case) 與 `ptyProcessContract.test.ts` (12 case) 不改任何一行即全綠
- `decideAutoReplace` 已在獨立檔 (`autoReplace.ts`),本 stage 不動它
- 純 inline 抽出 + 給 deps,沒有改變外部行為

### C.4 驗證

- `wc -l src/terminals/index.ts` ≤ 200 行
- `wc -l src/terminals/lifecycle.ts` ≤ 130 行
- `npm test` 既有 11 + 12 + 其餘 case 0 修改即全綠

---

## Stage D — Module-level mutable state 統一收口 (P1,1 hr)

### D.1 當前問題

`src/extension.ts` 用 2 個 module-level setter 把 state 注入到跨模組 consumer:

| 檔案                              | setter                    | consumer                                            | 為何這樣做                                  |
| --------------------------------- | ------------------------- | --------------------------------------------------- | ------------------------------------------- |
| `src/globalCommandsPlugin.ts:26-29`  | `setDiagnosticChannel`    | `superset.showLogs` 讀 `diagnosticChannel`          | `PluginContext` 沒暴露 `OutputChannel`      |
| `src/globalCommandsPlugin.ts:35-38`  | `setPluginManager`        | `superset.resetCaches` 讀 `managerRef`              | `PluginContext` 沒暴露 `PluginManager`      |
| `src/terminals/terminalSpawner.ts:25-32` | `setTerminalSpawner` / `getTerminalSpawner` | `installDefaultTools` / `skillInstall` 讀 spawner | `SharedDeps` 是 legacy `FeatureContext`, 不擴充 |

CLAUDE.md 沒明確禁止 module-level mutable state,但 stage 6 plan (`2026-07-08-chore-consistency-redundancy-scalability.md` §Stage 6) 點名要「`StatusBar` / `OutputChannel` 從 `BaseContext.showStatus` 落實為真的」。本 plan 在 Stage 6 之前加一道「**統一命名 + 統一目錄**」的小整理,讓 Stage 6 真正實作時只剩 DI 切換、不必再改呼叫端。

### D.2 目標形狀

```text
src/crossModuleState/         (新目錄)
├── diagnosticChannel.ts      (setDiagnosticChannel / getDiagnosticChannel)
├── pluginManager.ts          (setPluginManager / getPluginManager)
└── terminalSpawner.ts        (setTerminalSpawner / getTerminalSpawner)
```

既有檔案的位置與介面不變,只是內容搬到 `crossModuleState/`。`extension.ts` 的 import 改路徑。

### D.3 風險與撤銷策略

- 既有的 `test/installCommands.test.ts` (5 case) 不改任何一行即全綠
- 純檔案搬遷,沒改 API surface

### D.4 驗證

- `npm test` 5/5 + `pluginManager.test.ts` 7/7 全綠
- `grep -rn "setDiagnosticChannel\|setPluginManager\|setTerminalSpawner" src/ --include="*.ts"` 只命中 `extension.ts` (setter) + `crossModuleState/*.ts` (定義) + `globalCommandsPlugin.ts` / `terminals/index.ts` (consumer)

---

## Stage E — `.vscodeignore` 補完 + production `console.log` 淨空 (P0,30 min)

### E.1 當前問題

#### E.1.1 `.vscodeignore` 只 5 行

```
out/**/*.map
src/**
tsconfig.json
.gitignore
```

`test/` / `docs/` / `plans/` / `scripts/` / `coverage/` / `*.log` / `*.tsbuildinfo` / `.DS_Store` 全漏。VSIX 內會有 `test/` 與 `docs/` 的 markdown,讓最終下載體積變大。

#### E.1.2 Production 程式碼 4 處 `console.*`

| 檔案                                  | 行    | 內容                                                                                            |
| ------------------------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| `src/extension.ts`                    | 33    | `console.log("[superset] activated")`                                                          |
| `src/extension.ts`                    | 39    | `console.log("[superset] ${msg}")`                                                              |
| `src/globalCommandsPlugin.ts`         | 400   | `console.error("[superset] spawnRunTerminal failed ...")`                                        |
| `src/mdns/mdnsTransport.ts`           | 82    | `console.error("[mdns transport] error: ${err.message}")`                                         |

`extension.ts` 的兩處應走 `diag.appendLine` 同步存在;`globalCommandsPlugin.ts` / `mdnsTransport.ts` 屬於 plugin / 模組內,應走 `pCtx.log` 或被注入的 `log`。

### E.2 目標形狀

#### E.2.1 `.vscodeignore` 補到 ~20 行

```gitignore
out/**/*.map
**/*.tsbuildinfo
coverage/**
**/*.log
**/.DS_Store

src/**
test/**
scripts/**
docs/**
plans/**

.git/**
.github/**

tsconfig.json
.gitignore
AGENTS.md
README.todo
README.md
CHANGELOG.md
CLAUDE.md
LICENSE
```

#### E.2.2 4 處 `console.*` 替換為 log

- `extension.ts:33` 刪除 (diag channel `activate session=...` line 已有相同語意)
- `extension.ts:39` 移除 `console.log`;`log` 函式只走 `diag.appendLine` 一條路
- `globalCommandsPlugin.ts:400` 改用 `pCtx.log(\`spawnRunTerminal failed: ${err}\`)` (已有 try-catch 包,改用 ctx API 不需 try-catch)
- `mdnsTransport.ts:82` 把 `console.error` 換成「透過 transport 對外的 error listener」,或暫時改成靜默 (`return`) — 參考 RFC 6762 §10.1 對 mDNS 錯誤的處理慣例

### E.3 風險與撤銷策略

- `.vscodeignore` 補完後,`npx @vscode/vsce package` 輸出會縮小 10–30%;`npm test` 不受影響 (vsce 只影響 packaging)
- 4 處 `console.*` 改成 log 後,既有用戶若依賴 dev console 觀察啟用時機,可能需要改看 OutputChannel "Superset" — 在 `CHANGELOG.md` 加一行說明

### E.4 驗證

- `npx @vscode/vsce package --no-dependencies && unzip -l *.vsix | grep -E '(test|src|plans|docs)/'` 零命中
- `grep -rn "console\." src/ --include="*.ts" | grep -v "test/"` 零命中 (test 內的 `console.log` 留著是 dev 觀察用途)
- `npm test` 0 修改即全綠

---

## Stage F — 遺留 `@deprecated` re-export 與孤立腳本清理 (P2,30 min)

### F.1 當前問題

| 項目                                | 位置                                | 為何是問題                                                                                  |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `createTreePreviewExtension` re-export | `src/treePreview/plugin.ts:76`     | 標 `@deprecated`,但 `extension.ts` 仍可繞過 plugin adapter 直接呼叫;若已無 consumer 應刪 |
| `scripts/for_loop.sh` (62 bytes)    | `scripts/for_loop.sh`              | 內容無 commit message 對應、git log 沒歷史、CLAUDE.md 未提;孤立腳本                        |

#### F.1.1 `@deprecated` 是否仍被使用

```bash
$ grep -rn "createTreePreviewExtension" src/ --include="*.ts"
src/treePreview/index.ts: (定義)
src/treePreview/plugin.ts: (re-export)
src/extension.ts: (僅 import `treePreviewPlugin`,沒用到 factory)
```

→ **0 個 consumer**,可刪 re-export。

### F.2 目標形狀

- `src/treePreview/plugin.ts:73-76` 移除 `@deprecated` 段
- `scripts/for_loop.sh` 移到 `playground/archive/` 或直接 `git rm`(若無 commit 對應)

### F.3 風險與撤銷策略

- 純刪除;若有任何外部 import 還是用 `createTreePreviewExtension`,build 會立刻失敗
- `scripts/for_loop.sh` 刪除前 `git log --follow scripts/for_loop.sh` 確認無 commit 對應再 `git rm`

### F.4 驗證

- `grep -rn "createTreePreviewExtension" src/ --include="*.ts"` 只命中 `index.ts` (定義)
- `ls scripts/` 只剩必要腳本
- `npm test` 0 修改即全綠

---

## 不在本 plan 範圍

- `FeatureContext` 退場 (Stage 6 of `2026-07-08-chore-consistency-redundancy-scalability.md`) — 留給那個 plan
- `todo` × `projectsTodo` 引擎合併 (Stage 5) — 同上
- `todoStore.ts` 中剩餘 11 個業務方法各自的**演算法重構** (例如把 `applyArchiveOrComplete` 改用 AST 序列化) — 屬獨立 plan,本 plan 只做**檔案位置重排**,不動演算法
- `topologyStore.scan()` 的 timeout 邏輯 (CLAUDE.md §Stage 5 已加 `SCAN_TIMEOUT_MS`) — 不在本 plan
- `mermaid` / `architecture-diagram` / `codebase` 任何渲染改動 — 與本 plan 無關

---

## 驗證計畫

| Stage | 驗證                                                                       |
| ----- | -------------------------------------------------------------------------- |
| A     | `npm test` 23/23 + `wc -l src/todo/todoStore.ts` ≤ 280                    |
| B     | `npm test` 5/5 + 7/7 + `wc -l src/globalCommandsPlugin.ts` ≤ 130         |
| C     | `npm test` 11 + 12 + 其餘 0 修改即全綠 + `wc -l src/terminals/index.ts` ≤ 200 |
| D     | `npm test` 5/5 + 7/7 全綠 + `grep` 收口到 3 個檔                          |
| E     | `vsce package` 後 `unzip -l *.vsix` 無 `test/` / `src/` / `plans/` / `docs/` + `grep "console\." src/ --include="*.ts"` 零命中 |
| F     | `grep -rn "createTreePreviewExtension" src/` 只命中 `index.ts` + `ls scripts/` 只剩必要 |

---

## 預期效益

| 維度               | 改動前 | 改動後              | 量化                              |
| ------------------ | ------ | ------------------- | --------------------------------- |
| 1k+ 行 mega-file   | 1 個   | 0 個                 | `todoStore.ts` 1031 → 4 個 ≤ 280  |
| 405 行 mixed       | 1 個   | 3 個 ≤ 220          | `globalCommandsPlugin.ts` 拆出 `spawnRunTerminal` + `installCommands` |
| 7 關注點 / 273 行  | 1 個   | 2 個 ≤ 200          | `terminals/index.ts` lifecycle 抽出 |
| 模組級別 mutable   | 3 處散落 | 1 個 `crossModuleState/` 目錄 | 一眼可見                                  |
| VSIX 體積          | 含 test/docs/plans | 排除         | 預期 -10 ~ -30%                |
| `console.*` leak   | 4 處   | 0 處                | OutputChannel 統一                          |
| 死碼               | 1 re-export + 1 孤立腳本 | 0           | 縮減維護雜訊                              |

---

## 執行順序

```text
Stage E (P0, 30 min) → Stage D (P1, 1 hr) → Stage A (P1, 半天) → Stage B (P1, 1 hr) → Stage C (P2, 2 hr) → Stage F (P2, 30 min)
```

每個 stage 走完整 PR cycle (改 → `npm test` → commit → push),不一次 commit 全部。Stage E 與 Stage F 是純檔案 / 純文件改動,可同日合 PR;Stage A / B / C / D 各自獨立 PR,各自 review。

---

## 參考連結

- 既有 `2026-07-08-chore-consistency-redundancy-scalability.md` — Stage 4 / 5 / 6 互補
- 既有 `docs/specs/2026-07-02-architecture-superset.md` — `src/todo/` 拆檔歷史
- 既有 `docs/specs/2026-07-02-architecture-pluginization.md` — Plugin 框架設計脈絡
- CLAUDE.md §「`src/todo/` 內部拆檔 (Stage 2)」 — 描述了 parser / repository / store 三層,但**未涵蓋 store 內 11 個業務方法的下沉**
