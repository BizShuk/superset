# Lean Visibility-Scoped Runtime Implementation Plan

> `Agentic worker requirement`: use `executing-plans` and
> `test-driven-development`; execute each task in order and preserve unrelated
> dirty-worktree changes.

`Goal`: remove avoidable hidden-panel work, make repeated Sessions refreshes
incremental, and restore a clean test baseline without changing visible feature
behavior.

`Architecture`: background work follows Tree View visibility. The terminal
provider keeps event subscriptions active but only runs its rename-refresh timer
while visible. The Sessions feature owns one reusable `SessionStore`; the store
caches parsed append-only JSONL records by file metadata, while the provider
owns watcher lifecycle and only watches while visible.

`Tech stack`: TypeScript, VS Code Extension API, Node.js filesystem APIs,
Vitest.

## Global Constraints

- Keep `panelLayoutPlugin` last in activation order.
- Keep terminal activity sources `A` and `B` active; only the Tree View
  rename-refresh timer is visibility-scoped.
- Keep Sessions read-only except for `sample-*.jsonl`.
- Preserve the existing `autop` Default Tools edits and all unrelated dirty
  worktree changes.
- Use `cmd+alt+v`; VS Code keybinding JSON accepts `Alt`, not `Opt`, as the
  modifier token.
- Do not add a dependency.

---

### Task 1: Restore the manifest contract baseline

`Files`:

- Modify: `test/packageManifest.test.ts`

`Interfaces`:

- Consumes: `package.json#contributes.keybindings`
- Produces: a contract test matching the accepted VS Code keybinding token

- [x] `Step 1`: reproduce the focused failure.

Run:

```bash
npx vitest run test/packageManifest.test.ts
```

Expected: the Editor Layout case fails because the test expects
`cmd+opt+v`, while the manifest contains `cmd+alt+v`.

- [x] `Step 2`: replace both stale expectations.

```typescript
expect(cycle?.key).toBe("cmd+alt+v");
expect(cycle?.mac).toBe("cmd+alt+v");
```

- [x] `Step 3`: verify the focused contract.

Run:

```bash
npx vitest run test/packageManifest.test.ts
```

Expected: all manifest tests pass.

### Task 2: Pause terminal rename polling while the view is hidden

`Files`:

- Create: `test/terminalTreeProvider.lifecycle.test.ts`
- Modify: `src/terminals/treeProvider.ts`
- Modify: `src/terminals/index.ts`

`Interfaces`:

- Consumes: `TreeView.visible` and
  `TreeView.onDidChangeVisibility(listener)`
- Produces: `TerminalTreeProvider.setVisible(visible: boolean): void`

- [x] `Step 1`: add a failing lifecycle test using fake timers.

The test subscribes to `onDidChangeTreeData`, starts the provider, advances
three seconds while hidden, then toggles visibility:

```typescript
provider.start();
vi.advanceTimersByTime(3_000);
expect(refreshes).toHaveLength(0);

provider.setVisible(true);
vi.advanceTimersByTime(3_000);
expect(refreshes).toHaveLength(1);

provider.setVisible(false);
vi.advanceTimersByTime(3_000);
expect(refreshes).toHaveLength(1);
```

- [x] `Step 2`: run the focused test and confirm the API is missing.

Run:

```bash
npx vitest run test/terminalTreeProvider.lifecycle.test.ts
```

Expected: failure because `setVisible` does not exist and hidden polling still
runs.

- [x] `Step 3`: add visibility-owned timer synchronization.

`TerminalTreeProvider` keeps registry and group subscriptions in `start()`,
but moves timer setup into:

```typescript
setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.syncRefreshTimer();
}
```

`syncRefreshTimer()` clears an existing timer first and creates a new interval
only when the provider is started, visible, and the configured interval is
positive.

- [x] `Step 4`: connect the provider to the actual Tree View.

Immediately after `createTreeView`:

```typescript
treeProvider.setVisible(treeView.visible);
```

At the beginning of the visibility listener:

```typescript
treeProvider.setVisible(visible);
```

- [x] `Step 5`: verify focused terminal tests.

Run:

```bash
npx vitest run test/terminalTreeProvider.lifecycle.test.ts test/treeProvider.test.ts test/terminalsPlugin.test.ts
```

Expected: all focused tests pass.

### Task 3: Cache Sessions records and scope its watcher to visibility

`Files`:

- Modify: `src/sessions/store.ts`
- Modify: `src/sessions/sessionsTreeProvider.ts`
- Modify: `src/sessions/index.ts`
- Modify: `test/sessionsStore.test.ts`
- Modify: `test/sessionsTreeProvider.test.ts`

`Interfaces`:

- Consumes:
  `parseSessionJsonl(text, filePath, sizeBytes, mtimeMs): SessionRecord`
- Produces:
  `SessionStore.listSessionProjects(workspacePath): SessionProject[]`
- Produces:
  `SessionStore.readSession(filePath): SessionRecord | undefined`
- Produces:
  `SessionStore.deleteSession(filePath): boolean`
- Produces:
  `SessionsTreeProvider.setVisible(visible: boolean): void`

- [x] `Step 1`: add a failing cache regression test.

Construct a `SessionStore` with a parser spy, list the same unchanged file
twice, append a turn, and list again:

```typescript
const parser = vi.fn(parseSessionJsonl);
const store = new SessionStore(() => root, parser);

const first = store.listSessionProjects(workspace);
const second = store.listSessionProjects(workspace);
expect(parser).toHaveBeenCalledTimes(1);
expect(second[0].sessions[0]).toBe(first[0].sessions[0]);

appendFileSync(filePath, jsonl(turn(2)));
const third = store.listSessionProjects(workspace);
expect(parser).toHaveBeenCalledTimes(2);
expect(third[0].sessions[0].turns).toHaveLength(2);
```

- [x] `Step 2`: add a failing deletion-boundary test.

```typescript
expect(store.deleteSession(ingestedFile)).toBe(false);
expect(existsSync(ingestedFile)).toBe(true);
expect(store.deleteSession(sampleFile)).toBe(true);
expect(existsSync(sampleFile)).toBe(false);
```

- [x] `Step 3`: add a failing provider visibility test.

Before visibility, the provider has not scanned the store. On first visible
transition it loads projects; after hiding it releases the watcher but retains
the loaded snapshot:

```typescript
expect(provider.getChildren()).toEqual([{ kind: "empty" }]);
provider.setVisible(true);
expect(provider.getChildren()[0].kind).toBe("project");
provider.setVisible(false);
expect(provider.getChildren()[0].kind).toBe("project");
```

- [x] `Step 4`: run the focused tests and confirm the new contracts fail.

Run:

```bash
npx vitest run test/sessionsStore.test.ts test/sessionsTreeProvider.test.ts
```

Expected: failure because `SessionStore` and provider visibility lifecycle do
not exist.

- [x] `Step 5`: implement the reusable store cache.

Each cache entry contains:

```typescript
interface CachedSession {
    readonly sizeBytes: number;
    readonly mtimeMs: number;
    readonly record: SessionRecord;
}
```

`readSessionFile` performs `statSync` first, reuses an entry only when both
metadata values match, and otherwise reads and parses the JSONL. Directory
scans evict cached files that no longer exist. `deleteSession` rejects every
basename that does not match `sample-*.jsonl`.

- [x] `Step 6`: give the provider explicit start/stop visibility lifecycle.

`setVisible(true)` calls `start()`. `setVisible(false)` calls `stop()`.
`start()` loads once and starts the watcher idempotently. `stop()` disposes
only the watcher; `dispose()` also disposes the event emitter.

- [x] `Step 7`: share one store across tree and summary rendering.

In `src/sessions/index.ts`, construct one `SessionStore(dataDirOverride)`,
pass it to `SessionsTreeProvider`, use it from the content provider and delete
command, and connect initial/current Tree View visibility.

- [x] `Step 8`: verify focused Sessions tests.

Run:

```bash
npx vitest run test/sessionsStore.test.ts test/sessionsTreeProvider.test.ts test/sessionsOpenSummary.test.ts
```

Expected: all focused tests pass.

### Task 4: Centralize Tree View visibility handling

`Files`:

- Create: `src/plugin/viewVisibility.ts`
- Create: `test/viewVisibility.test.ts`
- Modify: `src/terminals/index.ts`
- Modify: `src/sessions/index.ts`
- Modify: `src/mdns/index.ts`
- Modify: `src/topology/index.ts`
- Modify: `src/todo/index.ts`
- Modify: `src/projectsTodo/index.ts`

`Interfaces`:

- Consumes:
  `TreeView.onDidChangeVisibility(Event<TreeViewVisibilityChangeEvent>)`
- Produces:
  `registerViewVisibility(view, viewId, onVisibilityChange?): Disposable`

- [x] `Step 1`: add a failing helper contract test.

The test passes a fake hidden view, captures the registered listener, and
asserts that initial visibility reaches the lifecycle callback while only a
later `{ visible: true }` event reports the active view:

```typescript
const registration = registerViewVisibility(
    view,
    "superset.test",
    onVisibilityChange
);

expect(onVisibilityChange).toHaveBeenCalledWith(false);
listener({ visible: false });
expect(executeCommand).not.toHaveBeenCalled();
listener({ visible: true });
expect(executeCommand).toHaveBeenCalledWith(
    "superset.reportViewVisible",
    "superset.test"
);
registration.dispose();
```

- [x] `Step 2`: run the focused test and confirm the helper is missing.

Run:

```bash
npx vitest run test/viewVisibility.test.ts
```

Expected: failure because `src/plugin/viewVisibility.ts` does not exist.

- [x] `Step 3`: implement the shared helper.

The helper calls `onVisibilityChange(view.visible)` once, then destructures
`{ visible }` from every VS Code event. It forwards every boolean transition to
the optional lifecycle callback and executes `superset.reportViewVisible` only
for `true`.

- [x] `Step 4`: replace all seven duplicated callbacks.

`Terminals` and `Sessions` pass their provider's `setVisible` method. The other
views use the two-argument form. This removes every callback that incorrectly
treats `TreeViewVisibilityChangeEvent` itself as a boolean.

- [x] `Step 5`: verify the helper and activation contracts.

Run:

```bash
npx vitest run test/viewVisibility.test.ts test/extensionActivate.test.ts test/terminalTreeProvider.lifecycle.test.ts test/sessionsTreeProvider.test.ts
npx tsc --noEmit
```

Expected: all focused tests pass and TypeScript exits `0`.

### Task 5: Record the runtime contract and verify the release artifact

`Files`:

- Create: `docs/specs/2026-07-27-visibility-scoped-runtime-work.md`
- Modify: `CLAUDE.md`
- Modify: `docs/terminology.md`
- Modify: `.vscodeignore`
- Modify: `scripts/verify-vsix.sh`
- Modify: `package.json`
- Modify: `package-lock.json`

`Interfaces`:

- Consumes: current highest release tag and the existing concurrent Default
  Tools manifest edits
- Produces: synchronized package versions and a durable performance invariant

- [x] `Step 1`: document the measured baseline and implemented boundaries.

The spec records:

- hidden `Terminals` stops only the 3-second rename tick;
- hidden `Sessions` releases its recursive watcher;
- unchanged Sessions JSONL records reuse parsed objects;
- ingestion records remain undeletable through `deleteSession`;
- no runtime dependency was removed because both direct dependencies are used.

- [x] `Step 2`: add the concise invariant to `CLAUDE.md`.

Add a maintenance-contract bullet stating that Tree View-only polling and
watching must be visibility-scoped, while functional terminal activity
tracking remains always on.

- [x] `Step 3`: synchronize internal terminology.

Add `View Visibility Boundary` under Plugin architecture and `Session Record
Cache` under Sessions, each with its implementation source.

- [x] `Step 4`: synchronize the next release version.

The highest existing tag is `v0.22.4`; set the package and lockfile root
versions to `0.22.5`, preserving the completed `autop` and lockfile changes.

- [x] `Step 5`: add failing lean-package verification.

Extend `scripts/verify-vsix.sh` to reject workspace-only metadata, native
`.pdb` debug symbols, known extraneous packages, and compiled `out/*.js` files
without a corresponding `src/*.ts` source.

- [x] `Step 6`: prove the current VSIX violates the new boundary.

Run:

```bash
bash scripts/verify-vsix.sh superset-0.22.5.vsix
```

Expected: failure because the pre-change artifact contains repo metadata and
stale compiled modules.

- [x] `Step 7`: clean stale output and exclude non-runtime payload.

Update `npm run clean` to remove `out/` before compilation. Extend
`.vscodeignore` with exact workspace metadata, `.pdb`, node-pty source/test
payload, and the two packages reported by `npm ls --depth=0` as extraneous.
Keep every platform prebuild and required `pkg/resources` file.

- [x] `Step 8`: rebuild and record package-size evidence.

Run:

```bash
npm run build
unzip -l superset-0.22.5.vsix | tail -1
```

Expected: the verifier passes, file count and archive size are below the
pre-change `558 files / 15.46 MB`, and both Darwin spawn helpers remain
executable.

- [x] `Step 9`: run focused and full verification.

Run:

```bash
npm test
npx tsc --noEmit
npm run build
git diff --check
```

Expected: zero failed tests, TypeScript exit `0`, build/VSIX verification exit
`0`, and no whitespace errors.

- [x] `Step 10`: inspect ownership and scope.

Run:

```bash
git status --short
git diff --stat
git diff -- src/terminals src/sessions test/packageManifest.test.ts test/terminalTreeProvider.lifecycle.test.ts test/sessionsStore.test.ts test/sessionsTreeProvider.test.ts docs/specs/2026-07-27-visibility-scoped-runtime-work.md CLAUDE.md package.json package-lock.json
```

Expected: user-owned `autop` edits remain present, and every runtime change is
covered by a focused test and the dated spec.
