# CLI Launcher Native SCM Tree 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repository requires direct work on `master`, so do not create a branch or worktree.

**Goal:** 在 CLI View Container 內保留 `Repo Path` View，新增跟隨單一 selected repository 的 native `Change` Tree View；以 staged / unstaged / untracked root groups 管理變更，提供 group/folder/file 層級的 `Discard` 與 `Stage` / `Unstage` actions、staged-only commit、狀態 marker 與 VS Code Diff Editor。

**Architecture:** `Repo Path` 與 `Change` 都使用 native Tree View。`Change` 以 non-empty root groups 與 compact folder/file hierarchy 呈現，actions 使用 native menus；commit message 使用 native Input Box。Git status parsing、Git process、diff source 與 Tree adapter 分成獨立責任；Tree selection 只傳入 normalized `CLIEntry`，所有 Git 操作都先守住 repository 自身 `.git` marker。

**Tech Stack:** TypeScript、VS Code Extension API `TreeDataProvider` / `TextDocumentContentProvider` / `vscode.diff`、Git porcelain v1 `-z`、Vitest。

## Global Constraints

- 輸出與文件使用繁體中文 + English Terminology。
- 直接在 `master` 工作，不建立 branch 或 worktree。
- 使用者驗收前不得 commit、push 或建立 PR。
- 不新增 dependency；沿用 Node.js、VS Code API 與既有 Git executable。
- `Commit Staged Changes` 只接受單一 selected repository，且只提交 staged changes；不得隱式 stage 其他 changes。
- 非空的 `Staged Changes`、`Unstaged Changes`、`Untracked Changes` 是 top-level Tree Items；其下使用 compact folder/file hierarchy。
- Group、folder 與 file 都提供 `Discard` 與對應的 `Stage` / `Unstage` native inline actions。
- `Discard` 必須先確認；untracked files 使用可復原的 Trash，不直接永久刪除。
- 狀態 marker 固定為 `U`（updated）、`A`（newly added）、`!`（conflict）、`D`（deleted）。
- `Change` 不使用 Webview、HTML、CSS 或 inline SVG；樣式完全交給 VS Code native Tree View 與 File Icon Theme。
- 每次行為變更以 TDD 的 RED → GREEN 驗證；最終執行完整 `npm test` 與 `npm run build`。
- Native Change Tree View 使用 minor version，`package.json` 與 `package-lock.json` 同步升為 `0.39.0`。

---

### Task 1: SCM status domain

**Files:**

- Create: `src/cliLauncher/scmStatus.ts`
- Test: `test/cliLauncherSCMStatus.test.ts`

- [x] Parse NUL-delimited Git status without breaking unusual paths。
- [x] Preserve rename/copy original path and project dual index/working-tree changes into separate groups。
- [x] Verify status marker and group projection behavior。

### Task 2: Repository, action, and Trash boundaries

**Files:**

- Create: `src/cliLauncher/scmRepository.ts`
- Create: `src/cliLauncher/scmActions.ts`
- Create: `src/cliLauncher/scmTrash.ts`
- Test: `test/cliLauncherSCMRepository.test.ts`
- Test: `test/cliLauncherSCMActions.test.ts`
- Test: `test/cliLauncherSCMTrash.test.ts`

- [x] Guard every operation with the selected folder's own Git marker。
- [x] Implement explicit stage / unstage / discard and staged-only commit operations。
- [x] Send untracked and newly staged files to VS Code Trash while restoring tracked content through Git。
- [x] Verify repository boundaries, partial failures, unusual paths, and recovery behavior。

### Task 3: Group-aware Diff Editor

**Files:**

- Create: `src/cliLauncher/scmPath.ts`
- Create: `src/cliLauncher/scmDiff.ts`
- Test: `test/cliLauncherSCMDiff.test.ts`

- [x] Provide staged `HEAD → index`, unstaged `index → working tree`, and untracked `empty → working tree` comparisons。
- [x] Keep virtual sides read-only and reject repository-relative path escape。
- [x] Verify modified, deleted, renamed, untracked, and invalid-path cases。

### Task 4: Native Change Tree View

**Files:**

- Create: `src/cliLauncher/scmTree.ts`
- Modify: `src/cliLauncher/index.ts`
- Test: `test/cliLauncherSCMTree.test.ts`
- Modify: `test/extensionActivate.test.ts`

- [x] Write RED tests for root groups, compact folders, native resources, actions, commit, generation, and stale selections。
- [x] Register `Change` through `createTreeView` and remove the obsolete Webview provider。
- [x] Render only non-empty root groups in staged / unstaged / untracked order。
- [x] Give group, folder, and file nodes native actions through opaque current-tree node IDs。
- [x] Preserve file click-to-Diff and refresh both CLI views after repository mutations。

### Task 5: Native commit message workflow

**Files:**

- Create: `src/cliLauncher/scmCommitMessage.ts`
- Modify: `src/cliLauncher/scmTree.ts`
- Test: `test/cliLauncherSCMTree.test.ts`

- [x] Collect manual commit text through native Input Box and reject blank messages。
- [x] Open the selected repository through VS Code Git provider before Antigravity generation。
- [x] Restore `Change` focus and prefill the generated message for user review before committing。
- [x] Reject stale generated results after repository selection changes。

### Task 6: Native manifest, docs, version, and delivery

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `test/packageManifest.test.ts`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/terminology.md`

- [x] Declare `Change` as native Tree View with native View title and inline menu contributions。
- [x] Remove obsolete Webview source, tests, styling, and documentation。
- [x] Update canonical docs and semantic version to `0.39.0`。
- [x] Run full tests, build, VSIX verification, and final stale-reference audit。

## Manual Acceptance Gate

- [ ] 使用者在 Extension Development Host 確認 `Staged Changes`、`Unstaged Changes`、`Untracked Changes` 是 root Tree Items，folder/file hierarchy 與 VS Code SCM panel style 一致。
- [ ] 使用者確認 group、folder 與 file 的 `Discard` / `Stage` / `Unstage` native inline buttons。
- [ ] 使用者以安全的 test repository 確認 Diff Editor、Stage / Unstage / Discard、generated message review 與 staged-only commit。
- [ ] 使用者明確核准後才可建立 project commit；核准前本 plan 保留在 `plans/`。
