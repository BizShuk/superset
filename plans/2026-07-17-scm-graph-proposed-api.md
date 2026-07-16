# SCM Graph Proposed API Implementation Plan

> `Agentic worker requirement`: use `executing-plans` and follow each TDD checkpoint in order.

`Goal`:讓 Superset 在 Antigravity Extension Development Host 透過 proposed `scm/historyItem/context`，直接於單一 Git commit 的右鍵選單顯示 `Reset Soft` 與 `Reset Hard`。

`Architecture`:Superset 自己宣告 `contribSourceControlHistoryItemMenu`，Graph menu contribution 正確放在 `contributes.menus`。Antigravity host 由 `.vscode/launch.json` 傳入 `--enable-proposed-api shuk.superset`；reset command handler 沿用既有 `src/git/`，不修改 Antigravity App。

`Tech Stack`:VS Code extension manifest、Antigravity IDE 2.1.1、TypeScript、Vitest、npm。

## Global Constraints

- 只測試 Superset proposed API 方案，不 patch `/Applications/Antigravity IDE.app`。
- `scm/historyItem/context` 是唯一 Graph commit menu id；刪除無效的 `scm/graph/context`。
- menu 僅在 `scmProvider == git && !listMultiSelection` 顯示。
- `Reset Soft` 排在 `4_modify@2`；`Reset Hard` 排在 `4_modify@3`。
- 保留既有 hard-reset modal 與 soft-reset direct execution。
- `package.json` patch version：`0.13.2` → `0.13.3`。
- 保留使用者現有、被 `.gitignore` 排除的 `.vscode/launch.json`。

---

### Task 1: Manifest regression contract

`Files`:

- Create: `test/packageManifest.test.ts`
- Modify: `package.json`

`Interfaces`:

- Consumes: `package.json#contributes.commands` 的 `superset.gitResetSoft` 與 `superset.gitResetHard`。
- Produces: valid `package.json#enabledApiProposals` 與 `package.json#contributes.menus.scm/historyItem/context`。

- [ ] `Step 1`:建立 failing test，讀取真實 `package.json` 並斷言：

```ts
expect(manifest.enabledApiProposals).toContain(
    "contribSourceControlHistoryItemMenu"
);
expect(manifest.contributes.menus["scm/historyItem/context"]).toEqual([
    {
        command: "superset.gitResetSoft",
        when: "scmProvider == git && !listMultiSelection",
        group: "4_modify@2",
    },
    {
        command: "superset.gitResetHard",
        when: "scmProvider == git && !listMultiSelection",
        group: "4_modify@3",
    },
]);
expect(manifest.contributes["scm/historyItem/context"]).toBeUndefined();
expect(manifest.contributes["scm/graph/context"]).toBeUndefined();
```

- [ ] `Step 2`:執行 `npm test -- test/packageManifest.test.ts`；預期因 `enabledApiProposals` 缺失且 menu 層級錯誤而 FAIL。
- [ ] `Step 3`:最小修改 `package.json`：加入 proposal、把 history menu 移入 `contributes.menus`、移除 graph menu、更新版本為 `0.13.3`。
- [ ] `Step 4`:重新執行 `npm test -- test/packageManifest.test.ts`；預期 PASS。

### Task 2: Development-host launch contract

`Files`:

- Verify only: `.vscode/launch.json`

`Interfaces`:

- Consumes: extension identifier `shuk.superset`。
- Produces: Antigravity Extension Development Host arguments `--extensionDevelopmentPath=${workspaceFolder}` 與 `--enable-proposed-api shuk.superset`。

- [ ] `Step 1`:以 `jq` 驗證 `.vscode/launch.json` 是有效 JSON，且 launch configuration 含完整 proposed API args。
- [ ] `Step 2`:執行 `npm run build`，確保 manifest 與 TypeScript build 可載入。
- [ ] `Step 3`:以 Antigravity CLI 啟動隔離 development host：

```bash
"/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide" \
  --user-data-dir /tmp/superset-antigravity-dev \
  --extensionDevelopmentPath=/Users/shuk/projects/tmp/superset \
  --enable-proposed-api shuk.superset \
  /Users/shuk/projects/tmp/superset
```

- [ ] `Step 4`:在新開的 Development Host 進入 `Source Control → Graph`，於單一 commit 上右鍵，確認直接顯示 `Reset Soft`、`Reset Hard`。只驗證選單與 hard-reset 取消流程，不實際執行 reset。

### Task 3: Documentation and full verification

`Files`:

- Modify: `README.md`
- Modify: `CLAUDE.md`

`Interfaces`:

- Consumes: Task 1 的 manifest 與 Task 2 的 launch workflow。
- Produces:使用者操作說明與技術限制紀錄。

- [ ] `Step 1`:在 `README.md` 說明 Graph reset menu 為 local proposed API 功能，以及開發時使用 `F5` launch configuration。
- [ ] `Step 2`:在 `CLAUDE.md` 修正先前把 `scm/historyItem/context` 描述為 stable 的錯誤，記錄 proposal 名稱與 host startup flag 限制。
- [ ] `Step 3`:執行 `npm test`；預期所有 test files 與 cases 通過。
- [ ] `Step 4`:執行 `npm run build`；預期 TypeScript compile 與 VSIX verifier 成功。
- [ ] `Step 5`:執行 `git diff --check` 與 `git status --short`，確認無 whitespace error，且不納入使用者原有的 `package-lock.json` 修改。
