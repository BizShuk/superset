# CLI Launcher Git Repository Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `test-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI Launcher 的兩層預設 discovery 只列出 Git repositories；非 repository 路徑只在 `superset.cliLauncher.entries` 明確選取後出現。

**Architecture:** Filesystem scan 保留完整兩層 directory candidates，讓 literal / Regex entries 仍能明確選取任何路徑。Catalog 先解析 explicit entries 與 hidden precedence，再由獨立 repository discovery boundary 將剩餘預設 rows 投影成 Git-only tree。第一層非 repository 若含有第二層 repositories，保留為 category container；其餘非 repository rows 不顯示。

**Tech Stack:** TypeScript、Node.js filesystem API、VS Code Extension API、Vitest、JSON Schema

## Global Constraints

- Git repository 只以該資料夾自己的 `.git` directory 或 file 判定，不得沿 parent repository 往上尋找。
- 固定掃描兩層，不做 recursive repository search。
- literal 與 Regex entries 必須在 Git-only filtering 前解析，因此可明確加入非 repository 路徑。
- 第一層 repository 顯示自己，children 只保留第二層 repositories。
- 第一層非 repository 只有在至少一個第二層 repository 可顯示時，才保留為 category container。
- repository probe 失敗視為非 repository，不得讓 CLI View 變成 error state；同時 probe 上限為 8。
- Tree View、Quick Pick 與 Copy All Paths 必須消費相同的 Git-only default catalog。
- 依 semantic versioning 將 package version 從 `0.34.1` 更新為 `0.35.0`。
- 不 commit、不 push、不安裝 VSIX。

---

### Task 1: Repository Discovery Contract

**Files:**

- Create: `src/cliLauncher/repositoryDiscovery.ts`
- Test: `test/cliLauncherRepositoryDiscovery.test.ts`

**Interfaces:**

- Consumes: catalog resolution 後的 `ScannedFolder[]`。
- Produces: Git-only default folders，並保留必要的第一層 category containers。

- [x] **Step 1: Write failing repository projection tests**

Cover layer-1 repository、layer-2 repository、`.git` file、non-repository omission、category retention、missing path fail-soft。

- [x] **Step 2: Run focused test and confirm RED**

Run: `npm test -- test/cliLauncherRepositoryDiscovery.test.ts`

Expected: FAIL because repository discovery interface does not exist.

- [x] **Step 3: Implement bounded repository probing and tree projection**

Expose one repository marker predicate shared by discovery and Git status, plus one projection function for default scanned folders.

- [x] **Step 4: Run focused test and confirm GREEN**

Run: `npm test -- test/cliLauncherRepositoryDiscovery.test.ts test/cliLauncherGitStatus.test.ts`

Expected: PASS with repository marker and fail-soft behavior covered.

### Task 2: Tree and Command Catalog Integration

**Files:**

- Modify: `src/cliLauncher/tree.ts`
- Modify: `src/cliLauncher/index.ts`
- Modify: `src/cliLauncher/gitStatus.ts`
- Test: `test/cliLauncherTree.test.ts`

**Interfaces:**

- Consumes: raw two-layer scan catalog plus Task 1 repository projection.
- Produces: matching default visibility for Tree View、Quick Pick、Copy All Paths；explicit entries remain unaffected.

- [x] **Step 1: Write failing Tree View integration tests**

Prove non-repositories disappear by default, non-repository category containers remain only for repository children, and literal / Regex entries can still surface non-repository paths.

- [x] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- test/cliLauncherTree.test.ts test/cliLauncherCatalog.test.ts`

Expected: FAIL because catalog folders are not repository-filtered.

- [x] **Step 3: Apply repository projection to every catalog consumer**

Tree rendering and command candidate enumeration must filter only ordinary scan folders after explicit entry resolution.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- test/cliLauncherRepositoryDiscovery.test.ts test/cliLauncherCatalog.test.ts test/cliLauncherTree.test.ts test/cliLauncherGitStatus.test.ts test/extensionActivate.test.ts`

Expected: PASS with existing Regex, hidden, filter, terminal, and command behavior preserved.

### Task 3: Canonical Documentation, Version, and Release Verification

**Files:**

- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/terminology.md`
- Create: `docs/specs/2026-08-06-cli-launcher-git-repository-discovery.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/packageManifest.test.ts`

**Interfaces:**

- Consumes: completed discovery behavior from Tasks 1–2.
- Produces: current business usage, maintenance invariant, terminology, historical specification, and synchronized package version.

- [x] **Step 1: Pin the user-facing settings contract in a manifest test**

The `roots` and `entries` descriptions must state that default discovery is Git-only and explicit entries can include non-repositories.

- [x] **Step 2: Update canonical documentation and add the dated specification**

Document category retention, exact `.git` boundary, explicit literal / Regex exception, and unchanged two-layer scan limit.

- [x] **Step 3: Synchronize semantic version**

Set both package manifests to `0.35.0` without creating a Git tag.

- [x] **Step 4: Run focused and full verification**

Run:

```bash
npm test -- test/cliLauncherRepositoryDiscovery.test.ts test/cliLauncherCatalog.test.ts test/cliLauncherScan.test.ts test/cliLauncherTree.test.ts test/cliLauncherGitStatus.test.ts test/packageManifest.test.ts test/extensionActivate.test.ts
npm test
npm run build
git diff --check
```

Expected: every command exits `0`; build produces and verifies the VSIX while leaving installation and Extension Development Host visual acceptance unperformed.

- [x] **Step 5: Audit scope and requirements**

Confirm the dirty worktree still contains only the existing Regex/hotkey work plus this Git-only discovery change; do not commit or push.
