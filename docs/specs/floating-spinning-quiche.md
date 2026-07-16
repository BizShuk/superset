# Superset: Source Control Graph Commit Context — Reset Hard / Reset Soft

## Context

VSCode 內建 Source Control Graph panel 在 commit 上右鍵,預設只有「Copy commit ID」「Open on GitHub」(若裝 GitHub ext)之類的 read-only 操作,**沒有** `git reset --hard <sha>` 或 `git reset --soft <sha>` 的捷徑。要執行這兩個常用操作,使用者目前必須:

1. 手動到 terminal 跑 `git reset --hard <sha>` — 容易拼錯 SHA 或打到錯的 repo
2. 或裝第三方 git graph extension — 額外依賴,不一定信任

我們在 `superset` 已經有完整的 shell command dispatch infrastructure (`spawnRunTerminal` + 內建 PTY-backed terminal),加這兩個操作的邊際成本極低,而且能跨 repo 使用 — 只要是 VSCode 開啟的 git folder 都吃得到,不必逐個 repo 安裝。

## Design Decisions

| 議題 | 決策 | 理由 |
| --- | --- | --- |
| 程式碼組織 | 新增 `src/git/` folder,獨立 plugin | 對齊 `mdns/` / `topology/` / `todo/` 等 feature-as-folder 慣例;plugin shim 與 mdns/todo 同形 |
| 跑 git 的方式 | 走 `spawnRunTerminal` 進 PTY-backed terminal | 與 `installDefaultTools` / `skillInstall` / `installIgnoreTemplate` 同模式;使用者看得到輸出、可 Ctrl-C 中斷、不需要新 child_process 依賴 |
| `reset --hard` 防呆 | Modal warning,內含 commit SHA (short) + subject line,按鈕 `Reset Hard` / `Cancel` | 對齊 `installIgnoreTemplate` overwrite modal 與 `resetCaches` reset modal 的風格;destructive 操作不可靜默執行 |
| `reset --soft` 防呆 | 不跳 modal | Soft 只動 HEAD 指標、不動 working tree / index;無資料丟失風險,直接執行 |
| Reset 後 SCM 面板同步 | 跑完後 `vscode.commands.executeCommand("git.refresh")` | 確保 Source Control Graph panel 立刻重抓;VSCode file watcher 在某些環境會 lag |
| Menu key | `scm/historyItem/context` | VSCode 唯一對外開放的 SCM Graph commit context menu extension point;命令接收 `(SourceControl, SourceControlHistoryItem)`,SHA 在 `historyItem.id` |
| 從 command palette 呼叫 | 跳 notification「請從 Source Control Graph 的 commit 上右鍵執行」 | 命令依賴 VSCode 傳入的 `historyItem`,palette 無法提供;靜默失敗比明確通知差 |

## Files to Add / Modify

### 新增 (4 個檔案)

**`src/git/gitReset.ts`** — 純函式,unit-testable,無 `vscode` import:
```typescript
export type ResetMode = "hard" | "soft";

/** Extract (repo, commit) from VSCode's `scm/historyItem/context` args.
 *  Returns nulls for either if the shape doesn't match (e.g. called
 *  from command palette without context). */
export function parseScmArgs(args: unknown[]): {
    repository: vscode.SourceControl | null;
    historyItem: vscode.SourceControlHistoryItem | null;
};

/** Build the shell-safe cmdline for `git reset --<mode> <sha>`. SHA is
 *  quoted via `quoteShellArg()` (existing helper) for consistency
 *  with `installCommands.ts`. */
export function buildResetCmdline(sha: string, mode: ResetMode): string;

/** Compose the modal warning text shown before `reset --hard`.
 *  Includes short SHA (first 7 chars) + subject line, capped at
 *  80 chars to keep the dialog readable. */
export function formatResetHardWarning(
    sha: string,
    subject: string | undefined
): string;
```

**`src/git/plugin.ts`** — plugin shim,模式同 `src/todo/plugin.ts`:
```typescript
export const GIT_PLUGIN_ID = "git";
export const gitPlugin: ExtensionPlugin = legacyPlugin({
    id: GIT_PLUGIN_ID,
    name: "Git",
    register: registerGitCommands,
});
```

**`src/git/index.ts`** — `register(ctx: PluginContext)` 主體,內部呼叫 `gitReset.ts` 純函式 + `spawnRunTerminal`,邏輯大致:
1. 從 `args` parse 出 `(repository, historyItem)`
2. 任一為 null → 跳 `showInformationMessage` 提示從 SCM Graph 執行,return
3. **Hard path**:`formatResetHardWarning` 餵給 `showWarningMessage({ modal: true })`;非 `Reset Hard` → return
4. `buildResetCmdline(historyItem.id, mode)` → `spawnRunTerminal(name, cmdline, { cwd: repository.rootUri.fsPath, closeOnSuccess: true })`
5. 200ms 後 `vscode.commands.executeCommand("git.refresh")` 強刷 SCM panel
6. 失敗 (`getTerminalSpawner()` undefined) → `showErrorMessage("Superset: Terminals 模組尚未啟用...")`,與 install commands 同樣 graceful 處理

**`src/git/` 內無 barrel** — 不對外 re-export,純 plugin shim 風格,比照 `src/todo/`。

### 修改 (2 個檔案)

**`package.json`** — 三處變更:
- `contributes.commands` 加 2 個 command:
  - `superset.gitResetHard` (`Superset: Reset Hard (this commit)`,icon `$(discard)`)
  - `superset.gitResetSoft` (`Superset: Reset Soft (this commit)`,icon `$(arrow-up)`)
- `contributes.menus` 加新鍵 `scm/historyItem/context`:
  ```json
  "scm/historyItem/context": [
      {
          "command": "superset.gitResetSoft",
          "group": "modification",
          "when": "scmResourceState == historyItem"
      },
      {
          "command": "superset.gitResetHard",
          "group": "modification",
          "when": "scmResourceState == historyItem"
      }
  ]
  ```
  Soft 排前面(較安全)— VSCode 同一 group 內按陣列順序顯示。
- `version` `0.12.2` → `0.13.0`(新增 feature,minor bump)

**`src/extension.ts`** — 在 plugins array 加 `gitPlugin`:
```typescript
import { gitPlugin } from "./git/plugin";
// ...
const plugins: ExtensionPlugin[] = [
    treePreviewPlugin,
    todoPreviewPlugin,
    terminalsPlugin,    // 必須早於 gitPlugin — gitPlugin 透過 terminalSpawner
    mdnsPlugin,
    topologyPlugin,
    todoPlugin,
    projectsTodoPlugin,
    gitPlugin,          // 新增,排在 panelLayout 之前
    globalCommandsPlugin,
    panelLayoutPlugin,
];
```
排序:放在 `globalCommandsPlugin` 之前(比照其他 feature plugin),確認 `terminalsPlugin` 在它前面(確保 spawner 已 wired)。

### 新增測試 (2 個檔案)

**`test/gitReset.test.ts`** — 純函式測試(~12 case):
- `buildResetCmdline` — hard 模式產出 `git reset --hard '<sha>'`、soft 模式產出 `git reset --soft '<sha>'`、SHA 含特殊字元(雖然實際不會)仍正確 quote
- `parseScmArgs` — 正常 `(SourceControl, SourceControlHistoryItem)` 雙參、空陣列、單一參數、形狀錯誤物件(無 `id` / `rootUri`)、包含 `undefined` 的退化輸入
- `formatResetHardWarning` — 含 short SHA + subject、subject 太長(>80 字)會截斷、subject undefined 時降級

**`test/gitPlugin.test.ts`** — 介面契約(3 case via `assertPluginContract`):
- 對齊 `terminalsPlugin.test.ts` / `mdnsPlugin.test.ts` 模式:`id = "git"`、`name = "Git"`、無 `contributeMarkdownIt`、有 `deactivate`

**注**:不寫 end-to-end SCM Graph menu 測試 — 需實際 extension host + 內建 git extension 介入,測試 ROI 低,且契約測試已涵蓋 register/activate 路徑。

## Existing Patterns to Reuse

- `spawnRunTerminal` (`src/spawnRunTerminal.ts`) + `quoteShellArg` — 已用於 install commands,本 feature 直接複用
- `legacyPlugin` factory (`src/plugin/legacyAdapter.ts`) — `src/todo/plugin.ts` 模式
- `assertPluginContract` (`test/pluginContract.shared.ts`) — plugin 介面測試
- Modal warning pattern — `src/installCommands.ts:154` (overwrite modal) 與 `src/globalCommandsPlugin.ts:42` (reset modal) 同形
- `terminalSpawner` graceful fallback — `src/installCommands.ts:57` 與 `src/spawnRunTerminal.ts:56` 已展示錯誤處理風格

## Verification

實作完成後跑:

1. `npm run build` — 確認 TypeScript + vsce package 都過(尤其 `scm/historyItem/context` 是 stable menu key,但 VSCode 1.93+ 才完整支援,我們的 `engines.vscode: ^1.93.0` 已對齊)
2. `npm test` — 預期 584 → 596 cases 全綠(新增 `gitReset.test.ts` 12 case + `gitPlugin.test.ts` 3 case;既有 581 不動)
3. 手動驗證:
   - F5 launch extension,在任一 git repo workspace 開 Source Control Graph panel
   - 右鍵任一 commit → 確認 menu 出現 `Reset Hard (this commit)` 與 `Reset Soft (this commit)`
   - 點 `Reset Soft` → 終端機跳出 `git reset --soft <sha>` 指令 → 跑完後 Graph panel 重抓(refresh)
   - 點 `Reset Hard` → 跳 modal 含 commit SHA + subject,按 `Cancel` 不執行
   - 再點一次按 `Reset Hard` → 終端機執行 → working tree 真的回到該 commit
4. 從 command palette 輸入 `Superset: Reset Hard (this commit)` → 跳「請從 Source Control Graph 的 commit 上右鍵執行」notification,不 crash

## Out of Scope (Explicitly)

- 不實作 reset 到 branch/tag(`git reset <ref>` 不是 `--hard/--soft`,語意不同,留給後續 PR)
- 不整合 `simple-git` 或 `node-git` 套件 — `spawnRunTerminal` 跑 `git` CLI 已足夠
- 不寫 SCM Graph 的 custom TreeView 取代內建 — 現有 PR 範圍只在右鍵選單加 2 個 entry,不重畫整個 panel
- 不動 `CLAUDE.md` / `docs/specs/` — 新 feature 不需回填架構章節,等後續歸檔階段再寫 spec