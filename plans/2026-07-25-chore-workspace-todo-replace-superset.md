# Plan: Replace `Superset -> TODO` view with workspace TODO scan + view switching

## Context

The current `superset.todo` view (registered in `src/todo/index.ts`, container `superset` / "SuperSet", view name "TODO") is hard-wired to a single `README.todo` at `<workspaceFolders[0]>/README.todo`. The user wants this view to instead mirror the Workspace TODO scan semantics — and add view-type switching (Section / Priority / File) on top.

Constraints (must hold):

- Keep the **view ID** `superset.todo`, the **container** `superset`, the **view name** `TODO`, and every existing title button: View: Section / View: Priority / View: File, New TODO, Filter P0 / P1 / P2, Hide Completed / Show All, Open README.todo.
- Keep every existing row context menu and inline action: Copy, Rename, Change Priority, Change Section, Archive, Rollback, Delete Item, Archive / Unarchive / Delete Section, Open Link, plus the four plan actions (Complete, Backlog, Archive, Delete).
- Scan boundary: identical to Overall Workspace TODO — `superset.projectsTodo.maxDepth` config (default 5, range 1–10) + `includeRoot = true`. Config change triggers re-scan.
- Workspace root's own `README.todo` IS scanned (depth 0 included).
- Empty state: when no `README.todo` exists, render a literal placeholder row.
- `superset.workspaceTodo` and `superset.projectsTodo` stay behavior-identical.

### Why "follow Overall Workspace TODO" instead of the original depth-1 plan

The user's first instinct ("depth-1 = immediate children") interpreted "just 1 layer right under current workspace" literally. After running the depth-1 build against a typical workspace (`/Users/shuk/projects/platform/superset` has only a root `README.todo`, no depth-1 ones), the panel showed an empty placeholder while Overall Workspace TODO rendered the root file. The user clarified they wanted the SuperSet TODO to behave like Overall Workspace TODO (same scan, same depth config), keeping only the view-type buttons as the differentiator.

The change is small:

- `loadWorkspaceTodos(ctx.workspaceFolder, 1, false)` → `loadWorkspaceTodos(ctx.workspaceFolder, maxDepth, true)`
- Add `superset.projectsTodo.maxDepth` config reader + `onDidChangeConfiguration` watcher
- Drop "immediate subdirectories" wording from the empty-state copy

The scanner lift (`src/todoEngine/workspaceScanner/`) and view-type support on `ProjectsTodoTreeProvider` are unchanged — they were always depth-agnostic.

## Recommended approach

**Hybrid B + small follow-on C**:

1. Lift the pure scanner (`collectTodoFiles` / `walkTodoFiles` / `TODO_SCAN_SKIP_DIRS`) out of `src/projectsTodo/projectsTodoStore.ts` into a new shared module `src/todoEngine/workspaceScanner/scan.ts`. The scanner is already pure (no `vscode` import, no listeners), so it moves verbatim. This avoids inverting the layer hierarchy (`src/todo/` and `src/projectsTodo/` both stay downstream of `src/todoEngine/`).
2. Have `src/projectsTodo/projectsTodoStore.ts` re-import the lifted scanner — public API unchanged, all 17 `projectsTodoStore.test.ts` cases continue to pass.
3. Add `viewType` / `setViewType` / `getViewType` to `ProjectsTodoTreeProvider` (plus priority/file group builders for the workspace section path) so the `View: Section/Priority/File` buttons have effect in the new depth-1 panel. Section-mode default behavior is preserved.
4. Rewrite `src/todo/index.ts` to drive a `ProjectsTodoStore` in workspace mode at depth = 1 with `includeRoot = false`, mounting it into `ProjectsTodoTreeProvider` in `rootMode="workspace"`. The 29-command `superset.todo*` factory surface, all title menu wiring, and the TreeView title stay byte-identical.
5. Update `package.json` `superset.projectsTodo.maxDepth` description to call out that it does NOT affect the SuperSet TODO panel.

`src/todo/todoStore.ts`, `src/todo/todoTreeProvider.ts`, `src/todo/parser.ts`, etc. stay in place as live code (their 30+ tests keep regression coverage). They are not deleted in this change.

## Critical files

| Path | Change |
| --- | --- |
| `src/todoEngine/workspaceScanner/scan.ts` (new) | Pure scanner lifted from `projectsTodoStore.ts`. Export `scanWorkspaceTodoDirs(root, maxDepth, includeRoot): Promise<string[]>` and `TODO_SCAN_SKIP_DIRS`. |
| `src/todoEngine/workspaceScanner/index.ts` (new) | Barrel re-export. |
| `src/todoEngine/index.ts` | Re-export the new barrel alongside existing factories. |
| `src/projectsTodo/projectsTodoStore.ts` | Remove inlined `collectTodoFiles` / `walkTodoFiles` / `TODO_SCAN_SKIP_DIRS`; import from the lifted module. `load` and `loadWorkspaceTodos` call sites unchanged. |
| `src/projectsTodo/projectsTodoTreeProvider.ts` | Add `viewType` field, `setViewType` / `getViewType`, push `superset.todo.viewType` context key in `start()`. Add `buildWorkspacePriorityGroups` / `buildWorkspaceFileGroups` helpers for the workspace section path. Add optional `emptyStateCopy` constructor flag. |
| `src/todo/index.ts` (rewrite) | Replace `TodoStore` + `TodoTreeProvider` with `ProjectsTodoStore` (workspace mode, depth=1) + wrapper provider that combines workspace rendering with view-type fan-out. Preserve all 29 commands, title buttons, menu bindings, factory wiring, and TreeView title. |
| `package.json` | Update `superset.projectsTodo.maxDepth` description to state it does not affect the SuperSet TODO panel. No view / container / view-name / command-title changes. |

## Reuse of existing utilities

- `scanWorkspaceTodoDirs` (newly lifted from `src/projectsTodo/projectsTodoStore.ts:217-300`) — pure, no `vscode` import.
- `applyPriorityFilter` / `filterCompleted` / `countPending` / `sortSiblings` / `extractPriorityTag` / `stripMarkdownLink` / `priorityIconPath` / `dispatchContextValue` — already exported by `src/todoEngine/` and `src/todo/todoTreeProvider.ts`.
- `createTodoCommands({ prefix, ... })` — `src/todoEngine/commandFactory.ts`; keep the prefix as `"todo"`.
- `computeTodoBadgeTitle` — `src/todo/badge.ts`.
- `completePlanFs` / `backlogPlanFs` / `archivePlanFs` / `deletePlanFs` — `src/todo/planActions.ts`.
- `TodoEngineItem`, `TodoCommandStore`, `TodoCommandTreeProvider`, `TodoCommandPlanActions` — already defined in `src/todoEngine/`.
- `linkUtils.ts` (single source of truth) — unchanged.

## Step-by-step execution

### 1. Lift the scanner

- Create `src/todoEngine/workspaceScanner/scan.ts` with the verbatim `collectTodoFiles` / `walkTodoFiles` body from `src/projectsTodo/projectsTodoStore.ts:217-300`, exported as `scanWorkspaceTodoDirs(root, maxDepth, includeRoot): Promise<string[]>`. Re-export `TODO_SCAN_SKIP_DIRS`.
- Create `src/todoEngine/workspaceScanner/index.ts` re-exporting the surface.
- In `src/todoEngine/index.ts`, re-export the new barrel.
- In `src/projectsTodo/projectsTodoStore.ts`, delete the private helpers and import from `../todoEngine/workspaceScanner`. `load` and `loadWorkspaceTodos` keep the same call shape.
- Run `npm test` — 17 `projectsTodoStore.test.ts` cases pass.

### 2. Plug the view-type gap on `ProjectsTodoTreeProvider`

- Add `viewType: "section" | "priority" | "file" = "section"` field.
- In `start()`: push `setContext("superset.todo.viewType", this.viewType)`.
- Add `setViewType(t)` / `getViewType()` methods.
- In workspace-mode `getChildren()`, branch on `this.viewType`:
  - `section` — existing behavior (unchanged).
  - `priority` — flatten items across all `workspaceStores`, apply `applyPriorityFilter` + `filterCompleted`, build P0 / P1 / P2 / None synthetic groups (reuse patterns from `src/todo/todoTreeProvider.ts:buildPriorityGroups`).
  - `file` — flatten items, group by source filename (`README.todo` default; other `.todo` paths via `extractLink`).
- Add constructor flag `emptyStateCopy?: string` to override the literal placeholder text when the wrapper panel passes its own copy.

### 3. Rewrite `src/todo/index.ts`

- Create `ProjectsTodoStore`; call `store.loadWorkspaceTodos(ctx.workspaceFolder, 1)` once on activation and on file-watcher events for `<workspaceFolder>/**/README.todo`. Scanner uses `includeRoot = false`.
- Mount `ProjectsTodoTreeProvider` in `rootMode="workspace"` with the new `emptyStateCopy`. Wire `viewType` default to `"section"`.
- Create `vscode.window.createTreeView("superset.todo", { treeDataProvider: provider, showCollapseAll: true, manageCheckboxStateManually: true })`.
- Replace `todoStoreAdapter`:
  - `toggle(item)` → `subStore = store.getWorkspaceStore(item.projectPath); subStore.toggle(item)`.
  - `updatePriority`, `archiveTodo`, `rollbackTodo`, `moveTodo`, `deleteTodo`, `archiveSection`, `unarchiveSection`, `deleteSection`, `updateText` → dispatch on the same `subStore`.
  - `addTodo(item, text, section)` → if `item.projectPath` set, dispatch; otherwise QuickPick of `store.getWorkspaceStores().keys()`. Empty → info message.
  - `openTodoFile(item)` → if `item.projectPath` set, open that subdir's `README.todo`; otherwise QuickPick when multiple depth-1 subdirs, first one when single; info when none.
- Replace `todoTreeAdapter`:
  - `toggleShowCompleted` / `isShowingCompleted` / `togglePriority` / `isPriorityEnabled` / `setViewType` / `getViewType` → delegate to the wrapper provider.
  - `getSectionList(item)` → look up the project sub-store via `store.getWorkspaceStore(item.projectPath)`, return its heading list; fall back to `["Default"]` when no project.
- `planActionAdapter` keeps `src/todo/planActions.ts` exports.
- `view.onDidChangeCheckboxState` handler iterates `e.items`; for `kind === "checkbox"` calls `subStore.toggle(pItem)`; for `kind === "plan"` dispatches `superset.todoCompletePlan`.
- File watchers:
  - `<workspaceFolder>/README.todo` → no-op (root excluded), trigger full re-scan.
  - `<workspaceFolder>/**/README.todo` → `loadWorkspaceTodos(ctx.workspaceFolder, 1)`.
  - `<workspaceFolder>/**/plans/*.md` → `store.reset()` then re-scan.
- Empty-state placeholder copy: `"No README.todo files in immediate subdirectories — drop one into a folder to see it here."` via the `emptyStateCopy` flag.
- Title badge: `computeTodoBadgeTitle("TODO", filtering, hidden)`, where `hidden = sum of getCompletedCount() across all workspaceStores`.
- `dispose()` mirrors the current `index.ts` shape; use `wrapperProvider.stop()`.

### 4. Manifest

- `package.json`: update `superset.projectsTodo.maxDepth` description to state explicitly that it governs the `Workspace TODO` and `Projects TODO` Overviews only and does NOT affect the SuperSet TODO panel (which always scans depth 1).
- No view / container / view-name / command-title changes. All `superset.todo*` command titles remain byte-identical.

### 5. Tests

#### New

| File | Coverage |
| --- | --- |
| `test/todoEngine/workspaceScanner.test.ts` | Depth 1 + `includeRoot=false`: only depth-1 matches; workspace root excluded; case-sensitive; dot-prefix skip; `TODO_SCAN_SKIP_DIRS` skip; multi-subdir aggregation. |
| `test/projectsTodoTreeProvider.viewType.test.ts` | `setViewType("priority")` flips context key + rebuilds P0/P1/P2 synthetic groups; `setViewType("file")` rebuilds file groups; `setViewType("section")` restores section-mode behavior. |
| `test/todoDepth1Panel.test.ts` | Rewritten `src/todo/index.ts`: workspace scan at depth 1, multi-subdir rendering, View Sec/PX/File buttons, Filter P0/P1/P2, Hide/Show, plan actions, mutations. New/Open without selection uses QuickPick or info. |
| `test/todoEmptyState.test.ts` | Empty workspace renders the literal placeholder copy. |

#### Must remain green (no changes expected)

- `test/projectsTodoStore.test.ts` — 17 cases, public API unchanged.
- `test/projectsTodoTreeProvider.test.ts` — section-mode default preserved.
- `test/todoStore.test.ts`, `test/todoTreeProvider.test.ts`, `test/todoArchiving.test.ts`, `test/todoParser.test.ts`, `test/badge.test.ts`, `test/plansSource.test.ts`, `test/planActions.test.ts` — `src/todo/` internals untouched.
- `test/todoEngine/commandFactory.test.ts` — 29-command factory contract unchanged.
- `test/packageManifest.test.ts`, `test/extensionActivate.test.ts`, `test/panelLayoutStorage.test.ts`, `test/panelLayoutRestoreView.test.ts`, `test/diagnosticsPanel.test.ts` — manifest shape preserved.

### 6. Verification

#### Manual

1. Open a workspace with multiple `README.todo` files at depth 1 (`<ws>/foo/README.todo`, `<ws>/bar/README.todo`, no root `README.todo`). SuperSet `TODO` view shows `foo/` and `bar/` folder rows; each expands to its contents + Plans sub-section if any.
2. View: Section → tree groups by `## Heading`. View: Priority → P0/P1/P2 groups. View: File → source filename groups. Icons swap on each toggle.
3. Filter P0 → only P0 rows visible. Hide Completed → completed rows hidden; title bar reads `TODO  (已隱藏 N 個已完成)`.
4. Right-click checkbox row → Copy / Rename / Change Priority / Change Section / Archive / Delete. Right-click `##` heading → Archive Section / Delete Section.
5. Right-click plan row → Complete / Backlog / Archive / Delete.
6. New TODO with no selection → QuickPick of depth-1 subdirs → text input → row appended. Open README.todo with no selection → QuickPick (or first one if single).
7. Empty workspace (no depth-1 README.todo) → placeholder row visible with literal copy.
8. Workspace with only root `README.todo` → still empty (root excluded).
9. `superset.workspaceTodo` and `superset.projectsTodo` views unchanged.

#### Automated

- `npm test` — full Vitest suite passes.
- `npm run build` — TypeScript clean + VSIX packaged + `scripts/verify-vsix.sh` passes.

## Risks and trade-offs

- **Backward compatibility**: existing users with a single root `README.todo` will see an empty TODO panel. Mitigated by placeholder copy and the unchanged `superset.workspaceTodo` view.
- **Mixed layout (root + subdirs)**: per spec, root is excluded. The panel shows only the subdirs.
- **New TODO without selection**: QuickPick of depth-1 subdirs; info when none.
- **Open README.todo without selection**: QuickPick when multiple subdirs; first one when single; info when none.
- **Project row with empty README.todo**: still surfaces the folder row with `0 pending`.
- **Activation order**: `todoPlugin` still activates before `projectsTodoPlugin` (no change).
- **`superset.workspaceTodo` / `superset.projectsTodo`**: untouched, including the `Workspace Todo (Current)` wrapper text — only the SuperSet TODO panel uses the new empty-state copy via the `emptyStateCopy` flag.

## Open assumptions

- The depth-1 panel does NOT honor `superset.projectsTodo.maxDepth`.
- Workspace root's own `README.todo` is excluded.
- View ID stays `superset.todo`; container stays `superset`; view name stays `TODO`.
- Command titles stay byte-identical (`Superset: New TODO`, `Superset: Open README.todo`, etc.).
- No deletion of `src/todo/` internals; they remain live but unused from `src/todo/index.ts` and may be revisited in a follow-up.