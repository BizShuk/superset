# CLI Launcher Regex Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `test-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `superset.cliLauncher.entries` 與 `superset.cliLauncher.hidden` 在保留既有 literal path 契約下，額外接受明確的 Regex rule。

**Architecture:** Regex 使用 `{ "regex": "...", "flags": "..." }`，避免與 Unix absolute path 混淆。Pure rule layer 負責 validation 與 path matching，pure catalog layer 將現有兩層 scan candidates 轉成 dynamic entries 並套用 hidden precedence；VS Code adapter 只負責讀寫 settings 與 UI action。

**Tech Stack:** TypeScript、VS Code Extension API、Vitest、JSON Schema

## Global Constraints

- 既有 `string` 與 `{ path, label? }` entries 必須維持相同行為。
- `entries` Regex 只從 `superset.cliLauncher.roots` 的既有兩層 scan candidates 解析，不做無界 filesystem traversal。
- literal Pinned Path 不受 `hidden` 影響；Regex 產生的 Dynamic Entry 仍屬 scan-derived path，`hidden` 優先且 `Remove from Panel` 可寫入 literal hidden exception。
- Regex 同時比對 normalized absolute path 與 `~/...` display path；invalid Regex 或 flags 直接忽略，不得讓 CLI View 進入 error state。
- `superset.cliLauncher.*` settings 維持 `application` scope 與 Global storage，不新增 `globalState`。
- 依 semantic versioning 將 package version 從 `0.33.6` 更新為 `0.34.0`。
- 不 commit、不 push、不安裝 VSIX。

---

### Task 1: Pure Regex Rules and Catalog Resolution

**Files:**

- Create: `src/cliLauncher/pathPattern.ts`
- Create: `src/cliLauncher/catalog.ts`
- Modify: `src/cliLauncher/entries.ts`
- Test: `test/cliLauncherEntries.test.ts`
- Test: `test/cliLauncherCatalog.test.ts`

**Interfaces:**

- Consumes: normalized `CLIEntry[]` scan candidates and current raw settings values.
- Produces: `normalizePathRegex()`、`matchesPathRegex()`、`normalizeEntrySelectors()`、`normalizeHiddenRules()`、`buildCLILauncherCatalog()`。

- [x] **Step 1: Write failing Regex normalization tests**

```ts
expect(normalizeEntrySelectors([{ regex: "(?:^|/)superset$", flags: "i" }], HOME)[0]).toMatchObject({
    kind: "regex",
    source: "(?:^|/)superset$",
    flags: "i",
});
expect(normalizeEntrySelectors([{ regex: "[" }], HOME)).toEqual([]);
expect(normalizeHiddenRules([{ regex: "(?:^|/)docs$" }], HOME)).toHaveLength(1);
```

- [x] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- test/cliLauncherEntries.test.ts test/cliLauncherCatalog.test.ts`

Expected: FAIL because Regex rule and catalog interfaces do not exist.

- [x] **Step 3: Implement rule validation and catalog selection**

```ts
export interface PathRegex {
    readonly kind: "regex";
    readonly source: string;
    readonly flags: string;
    readonly expression: RegExp;
}

export type EntrySelector =
    | { readonly kind: "literal"; readonly entry: CLIEntry }
    | PathRegex;

export type HiddenRule = string | PathRegex;
```

`buildCLILauncherCatalog()` 必須依 settings order 展開 Regex matches、去重、讓 explicit literal selector 優先，並在回傳 scanned tree 前移除 hidden 與已置頂的 paths。

- [x] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- test/cliLauncherEntries.test.ts test/cliLauncherCatalog.test.ts`

Expected: PASS with literal compatibility、invalid-pattern fail-soft、absolute/tilde matching、hidden subtree、dynamic-entry precedence all covered.

### Task 2: Settings, Tree, and Restore Integration

**Files:**

- Modify: `src/cliLauncher/config.ts`
- Modify: `src/cliLauncher/tree.ts`
- Modify: `src/cliLauncher/index.ts`
- Modify: `package.json`
- Test: `test/cliLauncherTree.test.ts`
- Test: `test/packageManifest.test.ts`

**Interfaces:**

- Consumes: Task 1 `EntrySelector[]`、`HiddenRule[]` 與 catalog result。
- Produces: application-scoped Regex-aware settings、dynamic rows、Regex-aware `Restore Hidden Paths`。

- [x] **Step 1: Write failing integration and manifest tests**

```ts
expect(entries.items.oneOf).toEqual(expect.arrayContaining([
    expect.objectContaining({ required: ["regex"] }),
]));
expect(hidden.items.oneOf).toEqual(expect.arrayContaining([
    expect.objectContaining({ required: ["regex"] }),
]));
```

Tree coverage must prove a Regex entry appears once before ordinary scan rows, hidden suppresses it, literal entries remain visible, and Regex hidden rules reach the scan catalog.

- [x] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- test/cliLauncherTree.test.ts test/packageManifest.test.ts`

Expected: FAIL because settings schema and provider integration still only understand literal paths.

- [x] **Step 3: Connect settings and UI behavior**

`config.ts` exposes normalized selectors/rules and writes raw Regex objects without collapsing them into paths. Tree rendering marks literal entries as Pinned Path and Regex matches as scan-derived rows; restore Quick Pick displays both literal paths and `/pattern/flags`, removing the selected rule by normalized identity.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- test/cliLauncherTree.test.ts test/packageManifest.test.ts test/extensionActivate.test.ts`

Expected: PASS with configuration, activation, row behavior, and restore boundaries intact.

### Task 3: Canonical Documentation, Version, and Release Verification

**Files:**

- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/terminology.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: final user-facing Regex contract from Tasks 1–2.
- Produces: current business usage, maintenance invariant, single terminology, and synchronized package version.

- [x] **Step 1: Document the supported setting forms and precedence**

```jsonc
"superset.cliLauncher.entries": [
    "~/projects/web",
    { "regex": "(?:^|/)(agentSDK|proxy)$", "flags": "i" }
],
"superset.cliLauncher.hidden": [
    "~/projects/web/tmp",
    { "regex": "(?:^|/)(docs|plans|tmp)$" }
]
```

- [x] **Step 2: Synchronize semantic version**

Set both package manifests to `0.34.0` without creating a Git tag.

- [x] **Step 3: Run focused and full verification**

Run:

```bash
npm test -- test/cliLauncherEntries.test.ts test/cliLauncherCatalog.test.ts test/cliLauncherScan.test.ts test/cliLauncherTree.test.ts test/packageManifest.test.ts test/extensionActivate.test.ts
npm test
npm run build
git diff --check
```

Expected: every command exits `0`; build produces and verifies the VSIX while leaving installation and Extension Development Host visual acceptance unperformed.

- [x] **Step 4: Audit scope and requirements**

Confirm `git status --short` contains only the plan, Regex feature, tests, docs, and synchronized version files; do not commit or push.
