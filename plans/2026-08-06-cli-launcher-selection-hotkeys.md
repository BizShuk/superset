# CLI Launcher Selection Hotkeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 CLI View 的快捷鍵只在已有 path selection 時生效，並改為 `Cmd+N` 開新視窗、`Ctrl+1–4` 依序開啟純 terminal、Claude、Codex、Grok。

**Architecture:** 沿用既有 command 與 `resolveEntries`，不新增 command path。由 Tree View selection event 維護單一 boolean context key，所有快捷鍵在 manifest 共用該 gate；Command Palette、Context Menu 與 Inline Actions 保持原行為。

**Tech Stack:** TypeScript、VS Code Extension API、Vitest、VS Code contribution manifest。

## Global Constraints

- 直接在 `master` 工作，不建立 branch 或 worktree。
- 只有真正的 path selection 能啟用快捷鍵；只有 keyboard focus 不算 selection。
- 不保留舊快捷鍵，不建立 compatibility alias。
- 所有 CLI hotkey 都只在 `focusedView == superset.cliLauncher.paths` 且沒有 Input focus 時生效。
- 版本以 patch bump 從 `0.35.1` 更新為 `0.35.2`。

---

### Task 1: Selection-aware Manifest Contract

**Files:**

- Modify: `test/packageManifest.test.ts`
- Modify: `test/extensionActivate.test.ts`

**Interfaces:**

- Consumes: `superset.cliLauncher.paths`、既有 CLI commands、Tree View selection event。
- Produces: 新 hotkey matrix 與 `superset.cliLauncher.hasPathSelection` lifecycle contract。

- [x] **Step 1: Write the failing manifest test**

將快捷鍵期望改成：

```ts
const expected = [
    ["cmd+n", "superset.cliLauncherOpenNewWindow"],
    ["ctrl+1", "superset.cliLauncherOpen"],
    ["ctrl+2", "superset.cliLauncherRunClaude"],
    ["ctrl+3", "superset.cliLauncherRunCodex"],
    ["ctrl+4", "superset.cliLauncherRunGrok"],
] as const;
```

每筆 `when` 必須等於：

```ts
focusedView == superset.cliLauncher.paths && superset.cliLauncher.hasPathSelection && !inputFocus
```

- [x] **Step 2: Write the failing runtime context test**

讓 VS Code mock 可發出 selection change，驗證 activation 初始化 `hasPathSelection=false`、path selection 更新為 `true`、非 path selection 或空 selection 更新為 `false`。

- [x] **Step 3: Run focused tests and verify RED**

Run:

```bash
npx vitest run test/packageManifest.test.ts test/extensionActivate.test.ts
```

Expected: FAIL，舊 manifest 仍是 `Ctrl+1–3` agent mapping，且 runtime 尚未同步 selection context。

### Task 2: Selection Gate and Hotkey Mapping

**Files:**

- Modify: `src/cliLauncher/index.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `TreeView.onDidChangeSelection`、`toCLIEntry`、既有 CLI commands。
- Produces: `superset.cliLauncher.hasPathSelection` context key 與五個 selection-only hotkeys。

- [x] **Step 1: Implement the minimal selection context lifecycle**

新增單一 exported context key，activation 時清為 `false`，selection change 時依 `selection.some(toCLIEntry)` 更新，dispose 時清回 `false`。

- [x] **Step 2: Replace obsolete hotkey mappings**

直接移除舊 mapping，建立 `Cmd+N` 與 `Ctrl+1–4` 的新 mapping；五筆共用相同 selection-aware `when`。

- [x] **Step 3: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run test/packageManifest.test.ts test/extensionActivate.test.ts
```

Expected: PASS，沒有 skipped 或 failed tests。

### Task 3: Product Documentation, Version, and Verification

**Files:**

- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: 已通過測試的新行為。
- Produces: 使用者操作說明、maintenance invariant 與 `0.35.2` package metadata。

- [x] **Step 1: Update current product and maintenance contracts**

README 說明 selection-only hotkeys；CLAUDE 記錄 hotkey mapping 與 context gate，不改寫既有 dated specs 的歷史語意。

- [x] **Step 2: Apply the patch version bump**

Run:

```bash
npm version 0.35.2 --no-git-tag-version
```

Expected: `package.json` 與 root package lock entry 都是 `0.35.2`。

- [x] **Step 3: Run full verification**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: 所有 tests 通過、VSIX build/verification 成功、diff whitespace check 無輸出。
