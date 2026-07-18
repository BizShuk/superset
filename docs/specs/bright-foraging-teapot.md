# Fix Workspace TODO View Registration And 5-Layer Scan

## Context

The user reports VSCode/Antigravity shows `No view is registered with id: superset.workspaceTodo`. The intended behavior is that the `Overview` activity container always has a `Workspace TODO` sub-panel, even when the current workspace has no `README.todo`. In the empty case, the panel should still perform a recursive workspace scan and show a placeholder if no `README.todo` is found.

Current code already has part of this behavior:

- `package.json` contributes `superset.workspaceTodo` under `contributes.views.superset-overall`.
- `src/projectsTodo/index.ts` calls `vscode.window.createTreeView("superset.workspaceTodo", ...)`.
- `ProjectsTodoTreeProvider` in `workspace` root mode returns workspace sub-project rows directly, or a `No README.todo files in this workspace` placeholder when `workspaceStores` is empty.
- `ProjectsTodoStore.loadWorkspaceTodos()` already scans from workspace depth `0` and continues through nested projects.

The missing hardening is to make this contract explicit and regression-tested, include `superset.workspaceTodo` in panel layout tracking, and change the default scan depth from `3` to `5` consistently.

## Recommended Implementation

1. Update the default recursive scan depth to 5.
   - Modify `package.json`:
     - `contributes.configuration.properties["superset.projectsTodo.maxDepth"].default`: `3` → `5`.
     - Update the description text from `Default 3` to `Default 5`.
   - Modify `src/projectsTodo/index.ts`:
     - `readMaxDepth()` fallback `.get<number>("maxDepth", 3)` → `.get<number>("maxDepth", 5)`.
     - Update nearby comments that mention default `3`.

2. Harden Workspace TODO view registration/persistence.
   - Modify `src/panelLayout/layoutStorage.ts`:
     - Add `"superset.workspaceTodo"` to `TRACKED_VIEW_IDS`.
     - Update the comment so `superset-overall` lists both `workspaceTodo` and `projectsTodo`.
   - This ensures the view can be persisted/restored like the other registered panels and prevents the layout layer from treating it as an unknown/stale id.

3. Add manifest regression coverage for the sibling Overall views.
   - Modify `test/packageManifest.test.ts`:
     - Extend the manifest type to include `contributes.views`.
     - Add an assertion that `contributes.views["superset-overall"]` contains both:
       - `id: "superset.workspaceTodo"`, name `"Workspace TODO"`, visibility `"visible"`.
       - `id: "superset.projectsTodo"`, name `"Projects TODO"`, visibility `"visible"`.
     - Optionally assert `workspaceTodo` appears before `projectsTodo`, preserving the intended panel order.

4. Update panel-layout tests.
   - Modify `test/panelLayoutStorage.test.ts`:
     - Expected `TRACKED_VIEW_IDS` list becomes six ids, adding `"superset.workspaceTodo"` before `"superset.projectsTodo"`.
     - Update the test description/comment from `five registered panels` to `six registered panels`.

5. Update workspace scan tests for 5-layer default semantics.
   - Modify `test/projectsTodoStore.test.ts`:
     - Keep existing explicit `maxDepth=3` tests if useful for boundary behavior.
     - Add or update a case showing depth `5` is found and depth `6` is not found when `maxDepth=5`.
   - Modify/add activation or registration-oriented tests if needed:
     - In `test/extensionActivate.test.ts`, capture `createTreeView` ids and assert both `superset.workspaceTodo` and `superset.projectsTodo` are created during activation.
     - This catches runtime regressions where the manifest exists but the feature stops calling `createTreeView`.

6. Update project docs/version.
   - Modify `CLAUDE.md` section `Recursive Current Workspace Sub-Panel`:
     - Change default `maxDepth` documentation from `3` to `5`.
     - Keep the existing statement that the panel always shows a placeholder when empty.
   - Modify `package.json` version per repo instruction:
     - Patch bump `0.13.10` → `0.13.11` because this is a bug fix/config default change.

## Critical Files

- `package.json` — VSCode view contribution, config default, version bump.
- `src/projectsTodo/index.ts` — creates `superset.workspaceTodo`, reads maxDepth fallback, watches workspace `README.todo` changes.
- `src/projectsTodo/projectsTodoStore.ts` — recursive workspace scan implementation; likely no logic change except test-driven confidence.
- `src/projectsTodo/projectsTodoTreeProvider.ts` — empty placeholder already exists; likely no logic change unless tests expose a gap.
- `src/panelLayout/layoutStorage.ts` — add `superset.workspaceTodo` to tracked/restorable view ids.
- `test/packageManifest.test.ts` — add manifest-level view contribution regression.
- `test/panelLayoutStorage.test.ts` — update tracked view id expectation.
- `test/projectsTodoStore.test.ts` — add/adjust depth-5 scan coverage.
- `test/extensionActivate.test.ts` — optionally assert `createTreeView` registers both Overall views.
- `CLAUDE.md` — keep project architecture notes aligned with the new default depth.

## Verification

1. Unit tests:
   - `npm test -- test/packageManifest.test.ts test/panelLayoutStorage.test.ts test/projectsTodoStore.test.ts test/projectsTodoTreeProvider.test.ts test/extensionActivate.test.ts`
   - Expected: all targeted tests pass.

2. Full validation:
   - `npm test`
   - `npm run build`
   - Expected: Vitest suite green, TypeScript compile succeeds, VSIX packaging/verification succeeds.

3. Manual VSCode/Antigravity check:
   - Launch Extension Development Host from this repo.
   - Open a workspace with no `README.todo`.
   - Open `Overall` activity container.
   - Expected: `Workspace TODO` sub-panel is visible and shows `No README.todo files in this workspace`.

4. Recursive scan check:
   - Create `a/b/c/d/e/README.todo` under the open workspace.
   - Reload/refresh the extension or trigger a file watcher event.
   - Expected: `Workspace TODO` lists `a/b/c/d/e`.
   - Create `a/b/c/d/e/f/README.todo` with default config unchanged.
   - Expected: depth-6 item is not listed unless `superset.projectsTodo.maxDepth` is increased.

5. Registration check:
   - Run `Superset: Focus Overall Panel`, then focus `Workspace TODO`.
   - Expected: no `No view is registered with id: superset.workspaceTodo` error.
   - If the error persists only in an installed VSIX, rebuild/reinstall the extension because VSCode view contributions are loaded from the installed manifest, not hot-patched runtime code.