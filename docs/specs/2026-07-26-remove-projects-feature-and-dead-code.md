# 移除 `src/projects/` 與死碼清理

## 狀態

已實作。落地於 v0.22.0。

## 動機

`src/projects/` 自建立以來從未列入 composition root。
[`2026-07-20-architecture-current-modules.md`](2026-07-20-architecture-current-modules.md)
第 25 行記錄了這個狀態（"has a plugin adapter but is not currently present in
the root activation list"），但該狀態一直沒有收斂——feature 持續存在、
持續被兩個 test 覆蓋、持續出現在 `CLAUDE.md` 的模組表，卻永遠不會執行。

同時 mermaid detection 於 `32c31ff` 移除後留下若干未清的殘骸。

## 移除 `src/projects/`

### 為何安全

| 對外介面 | 實際情況 |
| --- | --- |
| `superset.projects` view | `package.json#contributes.views` 內`不存在`。`createTreeView("superset.projects")` 即使執行也會失敗 |
| `superset.openProject` command | 由 `src/projectsTodo/index.ts:419` 同時註冊，且該 plugin 有接線。`src/projects/` 的註冊永遠不會發生 |
| `superset.refreshProjects` command | 只有 `src/projects/` 註冊，且不在 manifest 的 command 清單內。隨 feature 一併消失，無孤兒 |

因此移除沒有任何執行期影響——`superset.openProject` 的實際 owner 一直是
`projectsTodo`。

### 刪除的檔案

| 檔案 | 行數 |
| --- | --- |
| `src/projects/index.ts` | 59 |
| `src/projects/plugin.ts` | 14 |
| `src/projects/projectStore.ts` | 154 |
| `src/projects/treeProvider.ts` | 72 |
| `src/projects/types.ts` | 31 |
| `test/projectsPlugin.test.ts` | — |
| `test/projectsStore.test.ts` | — |

`test/projectsSetupScript.test.ts` 與 `test/projectsTodo*.test.ts` `保留`：
前者測 `pkg/resources/config/setup-projects.sh`（`installCommands` 的範疇），
後者屬 `src/projectsTodo/`，兩者與本 feature 無關。

## 死碼清理

| 位置 | 內容 | 依據 |
| --- | --- | --- |
| `src/mermaid/index.ts` | 整檔（re-export barrel） | src 與 test 皆無 importer；`src/terminals/index.ts` 直接 import `../mermaid/mermaidPreviewCommand`，且無目錄式 `from "../mermaid"` |
| `src/terminals/shellExecutionSource.ts` | `createShellExecutionChunkFanOut`、`ShellExecutionChunkFanOut`、`ShellExecutionChunkListener` | 其 JSDoc 自述為 mermaid buffer 而存在；detection 已於 `32c31ff` 移除。全 repo 零引用 |
| `src/terminals/terminalRegistry.ts` | `getById()`、`getEntryByTerminal()` | 零引用。`getById` 本身亦為錯誤實作：`vscode.Terminal.processId` 是 `Thenable`，`String(promise)` 對每個 terminal 都產生 `"[object Promise]"`，id 全數相撞 |
| `src/todo/todoBlockOps.ts` | `findSectionNameOfLine` 的 `export` | 同檔 `:138` 有呼叫，只是不需對外暴露。函式保留，僅移除 `export` |

## `plans/` 整理

移除 `plans/2026-07-21-feat-sessiond-project-level-hooks.md`：內容描述
`pkg/install/install.go`，該檔屬於 `~/projects/ai/sessiond`，誤置於本 repo。

其餘已落地但仍留在 `plans/` 的四份（`chore-claudemd-condense`、
`git-hooks-install-link`、`refactor-pty-data-pipeline-refresh`、
`chore-workspace-todo-replace-superset`）本次`刻意保留`，待另行決定。

## 未清理項目與理由

- `OutputWatcher` + `createShellExecutionSource`：目前是
  `superset.terminals.legacyOutputWatcher` 預設關閉的逃生門，不是死碼。
  待 [`2026-07-26-terminal-activity-sources-ab.md`](2026-07-26-terminal-activity-sources-ab.md)
  的 A/B 來源實機驗證後才適合整條移除。
- `src/diagnosticsPanel.ts` 的 `groupFromCommandId` map 內 `openProject` key：
  該查表以 `rest.match(/^([a-z]+)/)` 取 prefix，`openProject` 實際命中的是
  `open` key，故 `openProject` key 從未被讀取。屬既有問題，與本次無關，未動。

## 改動檔案

| 檔案 | 改動 |
| --- | --- |
| `src/projects/*` | 刪除（5 檔） |
| `test/projectsPlugin.test.ts`、`test/projectsStore.test.ts` | 刪除 |
| `src/mermaid/index.ts` | 刪除 |
| `src/terminals/shellExecutionSource.ts` | 移除 fan-out 區塊與隨之未使用的 `TerminalHandle` import |
| `src/terminals/terminalRegistry.ts` | 移除兩個未使用的 method |
| `src/todo/todoBlockOps.ts` | `findSectionNameOfLine` 取消 export |
| `plans/2026-07-21-feat-sessiond-project-level-hooks.md` | 刪除（誤置） |
| `CLAUDE.md` | 移除模組表 `src/projects/` 列；改寫其 invariant 為 `projectsTodo` 同時擁有清單與 TODO |
| `package.json` | version 0.21.1 → 0.22.0 |

## Verification

| 步驟 | 指令 | 結果 |
| --- | --- | --- |
| 型別檢查 | `npx tsc --noEmit` | 0 error |
| 完整測試 | `npx vitest run` | `937 通過 / 0 失敗`（自 940 減去已刪的 3 個 projects case） |
| 完整 build | `npm run build` | `superset-0.22.0.vsix` 驗證通過 |
