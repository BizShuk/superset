# Context

Root `CLAUDE.md` has grown to roughly 551 lines and currently mixes three responsibilities: operational instructions, current architecture, and detailed implementation/history for individual modules. This makes the file expensive to load and easy to drift (for example, Workspace TODO evolved from depth 3/stop-on-hit to depth 5/continue-on-hit). The requested change will make `CLAUDE.md` a compact technical index while preserving module details under `docs/specs/`, with active/unimplemented SCM work remaining under `plans/`.

“mode details” is treated as “module details”, matching the repository terminology and current `CLAUDE.md` headings.

## Recommended approach

1. Compact `CLAUDE.md` into an operational guide.
   - Keep the project purpose and links to `README.md`, `plans/`, and `docs/specs/`.
   - Keep the parent-repository relationship, Superset-specific commands, VS Code/Node engine requirements, and the corrected semantic-version instruction.
   - Reduce architecture content to the declarative `src/extension.ts` composition root, `PluginManager` responsibilities, and a concise current feature-module table.
   - Keep only high-value invariants that future code changes must respect, such as feature-local domain types, shared TODO link utilities, Markdown contributor exceptions, PTY-backed TUI detection, and the distinction between `projects`, `projectsTodo`, and Workspace TODO.
   - Replace detailed Stage 1–5 histories, lifecycle walkthroughs, behavior case lists, obsolete Plans behavior, and per-test-file counts with relative links.
   - Keep `plans/` vs `docs/specs/` semantics concise: active work stays in `plans/`; completed records live in `docs/specs/`.

2. Add one dated current-module reference at `docs/specs/2026-07-20-architecture-current-modules.md`.
   - Move the still-relevant implementation details that are currently unique to `CLAUDE.md` into this reference, organized by terminal/TUI, plugin composition, Todo/Projects TODO, Workspace TODO, mDNS, topology, previews, and Git.
   - Record only current implemented behavior; use “See also” links for detailed historical rationale already covered by existing specs instead of copying it again.
   - For Workspace TODO, document the final behavior: sibling `superset.workspaceTodo` view, empty placeholder, exact case-sensitive `README.todo`, depth 0 eligibility, default depth 5/range 1–10, skip directories, continued recursion after a hit, relative naming, separate store maps, duplicate suppression, and live configuration reload.
   - Link the historical implementation sequence (`tingly-tickling-shamir.md` and `bright-foraging-teapot.md`) rather than presenting their stale depth-3/stop-on-hit proposal as current behavior.
   - Link terminal/module history to the existing canonical specs, including `2026-06-20-terminal-dashboard-panel.md`, `2026-07-02-architecture-{master,superset,pluginization,terminals,mdns,topology}.md`, mDNS feature specs, Projects TODO/Plans specs, Mermaid extraction, and Copy GitHub URL specs.

3. Keep unfinished SCM work in its correct lifecycle location.
   - Remove the detailed SCM proposed-API narrative from `CLAUDE.md`.
   - Link only to `plans/2026-07-17-scm-graph-proposed-api.md`; do not copy or promote it into `docs/specs/` until implemented.

4. Update package metadata required by the repository rule.
   - Bump `package.json` from `0.13.11` to `0.13.12`.
   - Update both matching root package version entries in `package-lock.json` to `0.13.12` without regenerating unrelated dependency metadata.
   - Leave `README.md` unchanged unless link verification identifies an actual broken reference or scope mismatch.

## Critical files

- `CLAUDE.md` — compact operational context and specification index.
- `docs/specs/2026-07-20-architecture-current-modules.md` — dated home for current module implementation details.
- `docs/specs/tingly-tickling-shamir.md` — retained as historical Workspace TODO proposal; linked, not rewritten.
- `docs/specs/bright-foraging-teapot.md` — retained as the depth-5/view-registration follow-up; linked, not rewritten.
- `plans/2026-07-17-scm-graph-proposed-api.md` — active plan remains in place.
- `package.json`, `package-lock.json` — patch version synchronization.

## Reused sources of truth

- `src/extension.ts` and `src/plugin/` for the current composition/plugin structure.
- `src/shared.ts` for shared feature contracts.
- `src/todoEngine/linkUtils.ts` for shared TODO link behavior.
- `package.json#contributes` for current views, configuration, commands, menus, and engine constraints.
- Existing `docs/specs/` files for historical decisions and module-specific design rationale.

## Verification

1. Compare the compact `CLAUDE.md` against current code/manifest so its module inventory, view IDs, engine constraints, configuration key, and active-plan status remain accurate.
2. Validate every relative Markdown link in `CLAUDE.md` and the new dated spec; confirm no link points to a missing file.
3. Search for stale or contradictory current claims, especially `maxDepth` 3, stop-on-hit recursion, an active top-level Plans row, or SCM proposed API described as completed.
4. Confirm package versions are exactly `0.13.12` in `package.json` and both root entries in `package-lock.json`.
5. Run `npm test` and require the full Vitest suite to pass.
6. Run `npm run build` and require TypeScript compilation, VSIX packaging, and `scripts/verify-vsix.sh` to succeed.
7. If repository Markdown lint tooling is available, lint the two changed Markdown files; otherwise perform targeted structure/link checks without adding a dependency.

## Scope boundaries

- No runtime TypeScript behavior changes.
- No commit or push.
- Do not alter the unrelated untracked `plans/2026-07-19-multi-agent-session-summary.md` or `sessiond/` paths already present in the working tree.
