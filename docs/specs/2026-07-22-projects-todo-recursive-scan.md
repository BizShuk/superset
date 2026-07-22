# Projects TODO Single-Root Recursive Scan

## Outcome

`Projects TODO` now discovers project groups from one root, `~/projects`, instead of treating a nested folder as a second scan root. It recursively finds exact `README.todo` files through a fixed maximum depth of 5 and labels every group with the name of the folder containing the matched file.

The three TODO views retain separate boundaries:

| View | Boundary |
| --- | --- |
| `TODO` | The `README.todo` at the current project / workspace root |
| `Workspace TODO` | Current workspace root at depth 0 through its configured maximum depth, default 5 |
| `Projects TODO` | `~/projects` descendants at fixed depths 1 through 5 |

## Discovery Contract

- `~/projects` is the only global scan root and is depth 0.
- The root itself does not become a Projects TODO group.
- Descendant folders at depths 1 through 5 are eligible; depth 6 and deeper are excluded.
- Only the exact case-sensitive filename `README.todo` is eligible.
- Finding a `README.todo` does not stop traversal, so nested project folders can each become groups.
- Dot-prefixed directories and `node_modules`, `out`, `dist`, `build`, and `coverage` prune their complete subtree.
- A folder containing only `plans/*.md` does not become a project group. Existing per-project plan subsections remain available only after that folder qualifies through `README.todo`.

## Rendering Contract

Each matched directory remains keyed by its absolute path and is rendered with `path.basename(projectPath)` as the group label. The absolute path remains the row tooltip and command target, so same-named nested folders retain distinct data ownership.

Workspace and global stores remain separate. If an exact path exists in both stores, the Workspace TODO view remains the display source and Projects TODO suppresses its duplicate row.

## Verification

The store contract covers depths 1 through 5, exclusion at depth 6, continue-after-hit traversal, exact filename matching, skipped subtrees, a missing root, and plans-only exclusion. The provider contract verifies that a nested match is grouped by the containing folder name and retains its absolute path.
