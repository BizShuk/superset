# Current Module Architecture And Behavior

## Context

This document is the current implementation reference extracted from root [`CLAUDE.md`](../../CLAUDE.md). It records module boundaries and behavior that maintainers must preserve while older specs retain the chronological design history.

Current code and `package.json` remain the executable sources of truth. If an older spec conflicts with this document, treat the older file as a historical proposal and add a new dated follow-up rather than rewriting its original context.

## Composition And Module Boundaries

`src/extension.ts` is the declarative composition root. It creates `PluginManager`, registers shared diagnostic and TreeView state, and activates plugins in this order:

```tree
treePreview → todoPreview → terminals → mdns → topology → todo
    → projectsTodo → git → globalCommands → panelLayout
```

The order is intentional:

- Markdown contributors are composed in list order.
- Feature plugins register their views and disposables before global commands use them.
- `panelLayout` runs last so layout restoration targets live TreeViews.
- `PluginManager.activateAll` isolates a failed plugin instead of aborting the complete extension activation.

Feature modules live directly under `src/<feature>/`. Cross-feature framework contracts live in `src/shared.ts` and `src/plugin/`; domain types belong to their feature. `src/projects/` has a plugin adapter but is not currently present in the root activation list, while `src/projectsTodo/` owns the two Overall TODO views.

## Sessions

`src/sessions/` is a read-only consumer of the `sessiond` JSONL store under `~/.config/superset/data/sessions`. The Sessions TreeView has two levels: project groups and their session records. Project identity comes from the decoded store bucket path, not from individual JSONL metadata.

The current workspace root and every descendant workspace bucket are eligible. Containment uses path segments rather than string prefixes, so a sibling such as `utils-archive` is not included under `utils`. Empty buckets, `_unknown`, outside workspaces, and unreadable records are omitted. The root group sorts first; descendants use workspace-relative paths, and sessions within each group sort by latest activity.

The store root is watched recursively so existing descendant updates and newly created project buckets refresh the panel. Missing stores degrade to the manual refresh command. Sample seed/clear commands remain scoped to the current workspace root and only remove `sample-*.jsonl`; ingest-created sessions and descendant projects are not modified.

See also:

- [`2026-07-02-architecture-master.md`](2026-07-02-architecture-master.md)
- [`2026-07-02-architecture-pluginization.md`](2026-07-02-architecture-pluginization.md)
- [`2026-06-23-extension-module-split.md`](2026-06-23-extension-module-split.md)

## Terminals, TUI Detection, And Mermaid

`TerminalRegistry` is the state source for terminal rows and unseen activity. Two activity paths coexist:

- Existing VS Code terminals use Shell Integration through `OutputWatcher`; this is a fallback and cannot observe every full-screen TUI redraw.
- New PTY-backed terminals use `vscode.Pseudoterminal` with `@homebridge/node-pty-prebuilt-multiarch`, giving the extension the raw PTY data path.

`registry.markUnseen` is idempotent, so overlapping signals do not corrupt state. Terminals owned by other agents, such as names containing `antigravity`, are rejected before tracking and again during auto-replace decisions as defense in depth.

`PtyTerminalHost` resolves its `TerminalHandle` lazily through a closure because the Pseudoterminal host must exist before `vscode.window.createTerminal()` returns the terminal object. `TerminalHandle` intentionally exposes only `name`, `show`, and `dispose`; this keeps the core contract independent of broader or proposed VS Code APIs. Because modern `Terminal.name` is getter-only, highlighting can fall back to the panel and status bar when name mutation is unavailable.

Mermaid buffering, link detection, and preview live in `src/mermaid/`, but terminals still wire them because Mermaid detection operates on terminal output rather than as an independent TreeView plugin.

See also:

- [`2026-06-20-terminal-dashboard-panel.md`](2026-06-20-terminal-dashboard-panel.md)
- [`2026-07-02-architecture-terminals.md`](2026-07-02-architecture-terminals.md)
- [`2026-07-10-chore-dedup-mermaid-extract.md`](2026-07-10-chore-dedup-mermaid-extract.md)
- [`2026-06-22-terminal-groups-drag-and-drop.md`](2026-06-22-terminal-groups-drag-and-drop.md)

## Todo, Projects Todo, And Plans

`src/todo/` owns the current workspace's local TODO panel. Parsing is a pure Markdown-to-domain step, repository code owns file I/O, and the store owns in-memory state and mutations. Link parsing and copy formatting are centralized in `src/todoEngine/linkUtils.ts` for both local and cross-project panels.

`src/projects/` and `src/projectsTodo/` are separate concerns:

- `projects` discovers and groups projects.
- `projectsTodo` loads `README.todo` content and presents Workspace TODO and Projects TODO.

Projects TODO scans one root, `~/projects`, recursively from depth 1 through depth 5. It accepts only the exact case-sensitive filename `README.todo`; every matching folder becomes a project row labeled with that folder's basename, and a match does not stop descendant traversal. A project row remains visible even when filtering removes every visible child, defaults to collapsed, and reports pending count for visible unchecked tasks. Plan items use `kind: "plan"`, remain read-only, bypass task filters where appropriate, and do not contribute to pending counts. This current boundary supersedes the earlier first-level `~/projects/` plus `~/projects/tmp/` boundary; see [`2026-07-22-projects-todo-recursive-scan.md`](2026-07-22-projects-todo-recursive-scan.md).

The historical top-level merged Plans row is removed. Local plans belong to the local TODO scope; cross-project plans appear in their matching per-project subsection. Active plans remain in `plans/` until implementation is complete.

See also:

- [`2026-07-02-architecture-superset.md`](2026-07-02-architecture-superset.md)
- [`2026-07-08-feature-projects-todo-section-pending-badge.md`](2026-07-08-feature-projects-todo-section-pending-badge.md)
- [`2026-07-09-feature-plans-source-scan.md`](2026-07-09-feature-plans-source-scan.md)
- [`2026-07-22-projects-todo-recursive-scan.md`](2026-07-22-projects-todo-recursive-scan.md)

## Workspace TODO Recursive Scan

The `superset-overall` container registers two sibling views in this order:

1. `superset.workspaceTodo` — recursively scans the current VS Code workspace.
2. `superset.projectsTodo` — scans the established `~/projects` project boundary.

The views have independent collapse state. If a workspace root exists but no TODO file is found, Workspace TODO remains registered and returns the placeholder `No README.todo files in this workspace`.

The recursive scan contract is:

- Only the exact case-sensitive filename `README.todo` is accepted.
- Workspace root is depth 0 and is eligible.
- `superset.projectsTodo.maxDepth` defaults to 5 and accepts values from 1 through 10.
- Dot-prefixed directories and `node_modules`, `out`, `dist`, `build`, and `coverage` prune their complete subtree.
- Finding a `README.todo` does not stop recursion; nested projects are also collected within the depth limit.
- Nested rows use paths relative to the workspace root.
- `stores` for `~/projects` and `workspaceStores` for the current workspace remain separate.
- When the same path appears in both scopes, the Workspace TODO view is the display source and the Projects TODO duplicate is suppressed.
- Changes to `superset.projectsTodo.maxDepth` trigger a reload with the new value.
- Workspace-relative file watchers and project-root watchers may both observe the same file, but they reload separate store maps.

Historical sequence:

- [`tingly-tickling-shamir.md`](tingly-tickling-shamir.md) proposed the first recursive Current Workspace section with depth 3 and stop-on-hit semantics. Those two details are historical and no longer current.
- [`bright-foraging-teapot.md`](bright-foraging-teapot.md) hardened the sibling view registration, empty placeholder, panel persistence, and depth-5 default.

The current behavior above also includes the later continue-after-hit and sibling-view implementation reflected by code, tests, and `package.json`.

## mDNS

`MdnsRegistry` coordinates transport records, a pending merge window, `MdnsStore`, and `MdnsExpirationSweeper`. Parser functions handle PTR/SRV/TXT/address updates without VS Code dependencies. The store owns canonical services, network-key indexes, and detail cache.

Key invariants:

- Records belonging to one service are coalesced before publishing a frozen service value.
- `host|port|type` is the secondary network identity used to merge aliases while preserving a canonical row.
- Changing or removing a canonical service releases both forward and reverse network-key indexes.
- Expiration uses TTL with a grace multiplier and removes indexes together with the service.
- A continuing update advances `lastSeen`; merging must not allow a stale timestamp to expire a recently observed service.

See also:

- [`2026-07-02-architecture-mdns.md`](2026-07-02-architecture-mdns.md)
- [`2026-06-23-feature-mdns-service-expiration.md`](2026-06-23-feature-mdns-service-expiration.md)
- [`2026-06-24-feature-mdns-dedup.md`](2026-06-24-feature-mdns-dedup.md)
- [`2026-06-24-feature-mdns-detail-cache.md`](2026-06-24-feature-mdns-detail-cache.md)

## Topology

`TopologyStore` coordinates command execution and timeout handling. Pure transformation in `src/topology/transformer.ts` converts interfaces, trace, routing, DNS, and ARP inputs into `TopologyNode[]`. Scan execution uses a 10-second timeout boundary; tree rendering remains separated from collection and transformation.

The current `TopologyNode` shape still reflects VS Code TreeItem concerns. Do not silently change that public shape as part of an unrelated refactor; treat decoupling as a dedicated migration with contract coverage.

See also:

- [`2026-07-02-architecture-topology.md`](2026-07-02-architecture-topology.md)
- [`2026-06-22-network-topology-panel.md`](2026-06-22-network-topology-panel.md)
- [`2026-06-30-topology-trace-local-ip.md`](2026-06-30-topology-trace-local-ip.md)

## Markdown Previews

`treePreview` and `todoPreview` contribute `extendMarkdownIt` hooks instead of TreeViews. The root composes both hooks and returns the result from extension activation.

- `treePreview` renders fenced `tree` blocks through pure `renderLine` logic plus grammar and preview-style contributions in `package.json`.
- `todoPreview` only restructures documents whose first heading identifies a TODO document, then uses CSS-based folding/filter interaction. Ordinary Markdown previews must remain unchanged.

See also:

- [`2026-07-05-tree-comment-highlight.md`](2026-07-05-tree-comment-highlight.md)
- [`2026-07-01-feature-todo-css-preview.md`](2026-07-01-feature-todo-css-preview.md)

## Install And Setup Commands

`globalCommandsPlugin` owns command registration, while `src/installCommands.ts` owns the install/setup handlers and delegates visible shell work through the PTY-backed Run Terminal bridge. Bundled runtime scripts live under `pkg/resources/config/` and must be present in the packaged VSIX.

`Superset: Projects Setup` uses the fixed `~/projects` convention. Its bundled installer creates that root, clones the standard BizShuk repository set with recursive submodules, and makes reruns idempotent by initializing submodules in repositories that already exist. It does not pull or overwrite an existing repository. A same-name non-Git path is reported as a failure without preventing the remaining repositories from being attempted.

See also:

- [`2026-07-22-projects-setup.md`](2026-07-22-projects-setup.md)

## Git Commands

Explorer Copy GitHub URL uses stable `explorer/context` and local git metadata. `src/git/githubUrl.ts` normalizes SSH/HTTPS remotes, prefers `origin`, enforces repository-relative paths, and encodes path segments. It does not call GitHub, verify branch/file existence, or derive the current checkout; the generated URL intentionally uses `master`.

SCM Reset Soft/Hard is different: its history-item menu contribution depends on the proposed `contribSourceControlHistoryItemMenu` API and host startup authorization. The reset API remains active work in [`../../plans/2026-07-17-scm-graph-proposed-api.md`](../../plans/2026-07-17-scm-graph-proposed-api.md), not a completed spec.

See also:

- [`2026-07-17-copy-github-url.md`](2026-07-17-copy-github-url.md)
- [`2026-07-17-copy-github-url-implementation.md`](2026-07-17-copy-github-url-implementation.md)

## Verification Policy

Pure parsers, transformers, stores, and decision functions should run under Vitest without importing `vscode`. VS Code-bound orchestration is covered through extracted pure renderers, shared plugin contracts, manifest assertions, activation tests, and full VSIX build verification.

Required repository checks are:

```sh
npm test
npm run build
```
