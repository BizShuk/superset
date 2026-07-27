# Default Tools Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `github.com/bizshuk/auth@master` as the seventh CLI installed by `Superset: Install Default Tools`.

**Architecture:** Keep `src/installCommands.ts#DEFAULT_TOOLS` as the runtime source of truth and append `auth` after `autop` so the existing order remains stable. Lock the complete ordered command list in the existing command test, then synchronize the public README, terminology, dated specification, specification index, and package versions.

**Tech Stack:** TypeScript, Vitest, VS Code extension manifest, Markdown, npm package lock.

## Global Constraints

- Preserve all pre-existing dirty worktree changes.
- Preserve the existing order `pm2`, `skills`, `dux`, `port`, `sessiond`, `autop`; append `auth`.
- Install exactly `go install github.com/bizshuk/auth@master` in its own Run Terminal.
- Update both `package.json` and the root package entries in `package-lock.json` from `0.22.5` to `0.22.6`.
- Do not commit, push, or create a pull request.

---

### Task 1: Lock and implement the seventh Default Tool

**Files:**

- Modify: `test/installCommands.test.ts`
- Modify: `src/installCommands.ts`

**Interfaces:**

- Consumes: `DEFAULT_TOOLS: readonly InstallToolsSpec[]` and `installDefaultTools(ctx: PluginContext): Promise<void>`.
- Produces: A seventh `{ label: "auth", cmd: "go install github.com/bizshuk/auth@master" }` entry dispatched after `autop`.

- [x] **Step 1: Write the failing ordered-set test**

Change the test title to state that seven terminals are spawned and append this expected entry after `autop`:

```ts
{
    label: "auth",
    cmd: "go install github.com/bizshuk/auth@master",
},
```

Extend the fixed terminal-spawner fixture through the seventh terminal:

```ts
.mockReturnValueOnce(terminals[5])
.mockReturnValueOnce(terminals[6]);
```

- [x] **Step 2: Run the focused test to verify RED**

Run:

```bash
npm test -- test/installCommands.test.ts
```

Expected: the Default Tools test fails because the implementation dispatches six terminals while the test expects seven.

- [x] **Step 3: Add the minimal runtime entry**

Append this entry after `autop` in `DEFAULT_TOOLS`:

```ts
{
    label: "auth",
    cmd: "go install github.com/bizshuk/auth@master",
},
```

- [x] **Step 4: Run the focused test to verify GREEN**

Run:

```bash
npm test -- test/installCommands.test.ts
```

Expected: all tests in `test/installCommands.test.ts` pass with seven ordered terminal dispatches.

### Task 2: Synchronize release and documentation surfaces

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/terminology.md`
- Create: `docs/specs/2026-07-27-default-tools-auth.md`
- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: The seventh `DEFAULT_TOOLS` entry from Task 1.
- Produces: Package version `0.22.6` and one consistent public/technical description of the seven-tool ordered set.

- [x] **Step 1: Update semantic versions**

Set the package version in `package.json` and both root package version fields near the top of `package-lock.json` to:

```json
"version": "0.22.6"
```

- [x] **Step 2: Update user-facing and terminology documentation**

Change the README count from six to seven, append:

```markdown
- `auth` — `github.com/bizshuk/auth@master`
```

and include `auth` in the command summary. Change the `Default Tools` terminology definition to the same seven-item ordered set.

- [x] **Step 3: Add the dated implemented specification and index it**

Create `docs/specs/2026-07-27-default-tools-auth.md` describing `auth` as the seventh fixed-order command, then append its relative link to the `Default Tools CLI set` entry in `CLAUDE.md`.

- [x] **Step 4: Verify the synchronized version**

Run:

```bash
node -e 'const p=require("./package.json"); const l=require("./package-lock.json"); if (p.version !== "0.22.6" || l.version !== p.version || l.packages[""].version !== p.version) process.exit(1)'
```

Expected: exit code `0`.

### Task 3: Full verification

**Files:**

- Verify only; do not add unrelated changes.

**Interfaces:**

- Consumes: Tasks 1 and 2.
- Produces: Fresh evidence that the complete test suite, TypeScript build, VSIX package, and package-content checks succeed.

- [x] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: Vitest exits `0` with no failed tests.

- [x] **Step 2: Run the complete build**

Run:

```bash
npm run build
```

Expected: clean, install, TypeScript compile, VSIX package, and `scripts/verify-vsix.sh` all exit `0`.

- [x] **Step 3: Review the scoped diff**

Run:

```bash
git diff --check
git diff -- src/installCommands.ts test/installCommands.test.ts package.json package-lock.json README.md docs/terminology.md docs/specs/2026-07-27-default-tools-auth.md CLAUDE.md plans/2026-07-27-default-tools-auth.md
```

Expected: no whitespace errors, the seventh tool is consistent across all surfaces, and unrelated dirty worktree changes remain untouched.
