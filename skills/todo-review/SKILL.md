---
name: todo-review
description: >
    Use when asked to review, sort, prioritize, re-prioritize, triage, or
    re-organize a `.todo` file such as README.todo. Assigns each item a P0/P1/P2
    from business, UX, and system lenses, regroups items under feature-domain
    sections, moves completed items to Archive, and moves completed plans to
    docs/specs. Triggers only for files with the `.todo` extension.
version: "1.0.0"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
user-invocable: true
disable-model-invocation: true
effort: medium
context: fork
metadata:
    type: technique
    platforms: [macos, linux]
---

# TODO Review

## Overview

Re-prioritize and re-organize a `.todo` file (conventionally `README.todo` at the repo root) so every actionable item carries a justified `P0/P1/P2` and lives under a feature-domain section (not a date-stamped "Iteration N sweep"), while completed items are moved to the `## Archive` section and completed plan files are transitioned from `plans/` to `docs/specs/`. Priority is a judgment call across three lenses — business, UX, system — never a guess.

Core principle: `a .todo file is a parsed format, not prose`. Sorting that breaks the line format silently breaks whatever reads it. Format-correctness is non-negotiable; see [Hard format rules](#hard-format-rules).

Scope guard — `.todo` only. This skill operates exclusively on files whose name ends in `.todo`. If the target is a `.md`, `.markdown`, or any other extension, STOP and tell the user this skill only sorts `.todo` files — do not touch it, even if it contains a checkbox/TODO list. A `README.md` is never in scope; `README.todo` is.

## When to Use

- "review / sort / triage / re-prioritize the todo list", "todo-review", "review README.todo", "organize README.todo", "what should I work on next"
- After a planning sweep added many untagged items
- When sections are date-stamped sweeps (`### Iteration 4 …`) instead of feature names

Do NOT use for: any file that is not `.todo` (e.g. `README.md`, `*.markdown` — out of scope, leave untouched), toggling one item done, adding a single TODO, editing `plans/` specs.

## Workflow

0. `Check the extension first.` Confirm the target file ends in `.todo`. If not, stop — this skill does not apply (see [Scope guard](#overview)).
1. `Read the whole file` — every item, in every section, including `## Archive` and `## Plans`. Sorting a subset produces wrong priorities (you can't rank what you didn't read).
2. `Open referenced plans when ambiguous.` Items link `— see [plans/…md]`. If a one-line item is too thin to score, read its plan before assigning priority. Don't invent value the plan contradicts.
3. `Score each unchecked item` across the three lenses → derive `P0/P1/P2` (see [Priority rubric](#priority-rubric)).
4. `Re-home unchecked items into feature-domain sections` (see [Section taxonomy](#section-taxonomy)). Within each section order `P0 → P1 → P2`, untagged last.
5. `Move completed items into ## Archive and migrate finished plans.`
   - Collect all completed `[x]` items outside `## Archive` and append them to `## Archive`. Existing entries inside `## Archive` remain untouched in their original order (never reorder, delete, edit, or re-prioritize existing archived items).
   - Inspect any implementation plans in `plans/` referenced by completed items (e.g. `— see [plans/YYYY-MM-DD-topic.md](plans/YYYY-MM-DD-topic.md)`). Check whether all tasks corresponding to that plan are completed.
   - For every fully completed plan:
     1. Move the plan file: `git mv plans/<file>.md docs/specs/<file>.md` (or `mv` if untracked), preserving the `YYYY-MM-DD-<topic>.md` filename.
     2. Update references in the `.todo` file from `plans/<file>.md` to `docs/specs/<file>.md` (in the archived item line and across `## Plans` or `## Archive`).
     3. Remove or transition links to finished plans out of `## Plans`.
6. `Apply changes to the working tree only — do not commit.` Write the sorted file directly with the edit tools and stage plan moves with `git mv`. Never run `git commit` / `git push`; leave all changes in the working tree / staging area for the user to review.
7. `Report the diff in prose`: what moved, what was completed and archived, what plans were migrated to `docs/specs/`, what was re-prioritized and the lens that drove it, and what you couldn't decide. Then, as a final list, surface any valuable item currently sitting in `## Archive` (see [Archive surfacing](#archive-surfacing)) — list it, do not move it.

## Priority rubric

Rate each unchecked item on three lenses, then combine. Score the *item as written*, not the feature you wish it were.

| Lens | High signal | Low signal |
| --- | --- | --- |
| Business (B) | Gates a release; blocks adoption; correctness bug users hit | Cosmetic; internal-only nicety |
| UX (U) | Removes daily friction; improves discoverability of an existing surface | Edge-case convenience; power-user-only |
| System (S) | Foundation many other items depend on; stability/maintainability debt | Isolated; touches one file; no dependents |

Combine:

- `P0` — any lens `High` AND (blocks shipping, or is a correctness/lifecycle bug, or is a foundation ≥2 other items depend on). Unchecked bug-style items with no tag (e.g. a parsing error) default to `at least P1, usually P0`.
- `P1` — clear value, ≥1 lens High/Med, but nothing is blocked waiting on it.
- `P2` — nice-to-have, isolated, low reach. Most `[chore]` / `[refactor]` polish and speculative features land here (unless they unblock a release — see the dependency override).

Dependency override: if item A is a prerequisite for B/C/D, A inherits the `max` priority of its dependents. A `chore` that unblocks a release (CI, packaging) is business-High even though it's "just a chore".

When two items tie, the one with more dependents or a written plan ranks first.

## Section taxonomy

Derive the section names from the target codebase, never from a fixed list. Inspect the repo's feature directories — whatever the project uses as its unit of feature code (`src/<feature>/`, `cmd/<feature>/`, `plugins/<feature>/`, `internal/<domain>/`, a monorepo's `packages/<name>/`) — and name one section per domain that actually has items. A domain with no items gets no section.

The resulting shape is always:

```tree
<name>.todo
├── (top, no heading)   # cross-cutting P0 bugs not tied to one domain
├── ## <Feature domain> # one section per feature directory that has items
├── ## <Feature domain>
├── ## Architecture     # ALL non-functional work — chore, refactor, build/packaging, CI, deps, docs, tooling, tests, perf infra, baseline
├── ## Plans            # links to active plans/ implementation docs (completed plans moved to docs/specs/)
└── ## Archive          # completed [x] items & historical entries; existing entries preserved
```

Only `## Architecture`, `## Plans` and `## Archive` are fixed; every other heading comes from the codebase in front of you. A section name must name a feature or concern, never a date or sweep number.

Functional vs non-functional routing. Decide first whether an item is functional (changes user-facing behavior) or not:

- Non-functional → `## Architecture`. Everything that is not a user-facing feature: `[chore]`, `[refactor]`, build/packaging, CI/CD, dependencies, version baselines, docs, tooling, test infrastructure, performance/structural work. These don't add or change a runtime feature, so they live together regardless of which feature's code they touch — not scattered across feature sections.
- Functional → feature-domain section. `[feature]` items and bugs (untagged actionable defects in runtime behavior) → the matching feature section. If a feature item fits two domains, file it under the one whose code it changes most.

Test: "Does completing this change what the user can do or observe?" No → `## Architecture`.

## Archive surfacing

`## Archive` stores completed tasks and historical backlog items. During a sort, newly completed items (`- [x]`) are appended to this section, while existing archived entries remain untouched. After rewriting the file, scan Archive once and surface — in the final response only, not in the file — any item that scores `P0`/`P1` under the [Priority rubric](#priority-rubric) (e.g. a `[feature]` with a written plan, or a still-unchecked `[ ]` parked there). For each, give: the item text, the lens that makes it valuable, and the priority it would earn if revived. Do not move or edit it; the user decides whether to pull it out.

## Hard format rules

A `.todo` file is a machine-parsed format: some editor extension, panel, or script reads it line by line and matches each item against a regex. Treat the line grammar below as a contract you may not renegotiate — a reordering that is visually fine but grammatically wrong silently drops items from whatever renders them. If the project ships its own parser, read it before sorting and let it override any rule here.

- Priority tag is first in the item text, right after the checkbox: `- [ ] [P0] [feature] …`. Priority regexes conventionally match only a leading `[Px]` / `(Px)`, so `- [ ] [feature] [P0]` will NOT be recognized.
- Canonical line: `` `- [ ] [Px] [type] description — see [link](path)` `` (priority → type tag → text → reference).
- Keep checkbox state (`[ ]` vs `[x]`) exactly; sorting never silently completes or un-completes an item.
- Sections are `##` / `###` headings only. One blank line between a heading and its items.
- Preserve `[feature]` / `[chore]` / `[refactor]` tags and every markdown link target.
- Only `P0`, `P1`, `P2` are valid (or none). No `P3`, no bare numbers.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Priority tag placed after `[feature]` | Tag goes first: `[P0] [feature]`, the parser won't read it otherwise |
| Sorting only the visible/top items | Read the entire file first; priorities are relative across all items |
| Keeping `### Iteration N (date sweep)` headings | Re-theme to feature domains |
| Filing a chore/CI/docs/refactor item under a feature section | All non-functional work → `## Architecture`; ask "does it change what the user can do?" first |
| Guessing priority from the title | Open the linked plan when the item is thin |
| Assigning P0 to everything urgent-sounding | P0 is reserved: High lens + blocking/bug/foundation |
| Leaving completed `[x]` items in active sections | Move completed `[x]` items to `## Archive` |
| Deleting or re-ordering existing `## Archive` items | Preserve existing archive entries as-is; only append newly completed items |
| Leaving completed plans in `plans/` | Move completed plan files to `docs/specs/` and update references in `.todo` to `docs/specs/` |
| Moving plans with pending items | Only move a plan to `docs/specs/` when all associated tasks are completed `[x]` |
| Committing the sorted file | Apply to the working tree only; never `git commit`/`push` |
| Dropping `— see [link]` references when moving | Move the whole line verbatim, links intact |

## Output language

Match the target repo's existing `.todo` and docs. When they are written in Traditional Chinese, write new section names and the change summary the same way, with the English term in round brackets where natural (e.g. `## 排程 (Scheduler)`); when they are in English, stay in English. Use `backtick` rather than bold for highlight. Item text itself is preserved as written.
