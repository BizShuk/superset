# Modified Files Explorer Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register a "Modified Files" panel in VSCode's built-in Explorer view, listing currently-modified files in folder hierarchy. Auto-excludes `.gitignore` files via git status; FSW-debounced refresh; read-only navigation actions.

**Architecture:** Tree of synthetic folder nodes (built from flat git status output) + real file rows. Two pure-function layers (`gitStatusParser` + `treeBuilder` + `treeSpec`) drive most of the logic without `vscode` imports. A thin store orchestrates git spawn + FSW debounce. Plugin wiring uses the existing `ExtensionPlugin` + `createFeatureContext` shim pattern.

**Tech Stack:** VSCode Extension API 1.93+, Node.js 20+, `child_process.execFile` for git, `vscode.workspace.createFileSystemWatcher`, vitest for tests, TypeScript 5.4 strict mode.

**Spec:** [`docs/specs/2026-07-11-modified-files-explorer-panel.md`](../specs/2026-07-11-modified-files-explorer-panel.md)

## Global Constraints

- VSCode engines: `^1.93.0` (matches `package.json#engines.vscode`)
- Node engines: `>=20.0.0`
- Test framework: vitest (`npm test`)
- TypeScript strict mode (project default)
- All new code follows existing project conventions (see `CLAUDE.md`)
- Pure-function modules: NO `vscode` import — testable in plain vitest
- Plugin pattern: implement `ExtensionPlugin` interface (`id`, `name`, `activate`, `deactivate`) defined in `src/plugin/types.ts`
- Plugin contract test: use `test/pluginContract.shared.ts` `assertPluginContract` helper
- Existing `444` tests must remain green throughout (run `npm test` after every commit)
- Style: no bold in markdown, use backticks for emphasis
- File path convention: new files go under `src/modifiedFiles/`, new tests under `test/`
- Test count budget: ~33 new cases (gitStatusParser 12 + treeBuilder 10 + treeSpec 8 + plugin contract 3)
- Version bump: `0.10.3` → `0.10.4` (patch)
- Git commit message prefix: `feat(modifiedFiles): ...` for new feature, `test(modifiedFiles): ...` for tests, `docs(specs): ...` for spec changes
- Each task ends with `git add` + `git commit` + `npm test` verification

---

## Phase 1 — Pure modules (parallelizable)

Tasks 1-4 produce the entire pure-function layer (types + 3 parsers/builders). Each is fully independent and can be implemented in parallel by separate subagents. All four tasks must complete before Phase 2 begins.

### Task 1: Type definitions

**Files:**
- Create: `src/modifiedFiles/types.ts`
- Modify: none
- Test: none (pure type declarations — TS compiler validates)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `FileStatus = "M" | "A" | "D" | "R" | "?"`
  - `ModifiedFile { path, status, oldPath? }`
  - `TreeNode` (discriminated union: `kind: "folder"` with `children`, `statusSummary`; `kind: "file"` with `status`, `oldPath?`)
  - `TreeItemSpec { label, iconId, description?, tooltip, collapsibleState, contextValue, command? }`

- [ ] **Step 1: Create types.ts**

```typescript
// src/modifiedFiles/types.ts

export type FileStatus = "M" | "A" | "D" | "R" | "?";

/**
 * Single modified file as parsed from `git status --porcelain`.
 * `path` is repo-relative (POSIX separators).
 * `oldPath` only set when status === "R" (rename/copy old name).
 */
export interface ModifiedFile {
    readonly path: string;
    readonly status: FileStatus;
    readonly oldPath?: string;
}

/**
 * Tree node produced by `treeBuilder.build()`. Folder nodes are synthetic
 * (created only when they have modified descendants); file nodes correspond
 * directly to `ModifiedFile` entries.
 *
 * `statusSummary` on folder nodes is a Map<FileStatus, count> covering all
 * descendants (recursive). Pre-computed by `treeBuilder` so `treeSpec` does
 * not need to walk the tree.
 */
export type TreeNode =
    | {
          readonly kind: "folder";
          readonly label: string;
          /** Repo-relative path (POSIX), e.g. "src/plugins". */
          readonly path: string;
          readonly children: readonly TreeNode[];
          readonly statusSummary: ReadonlyMap<FileStatus, number>;
      }
    | {
          readonly kind: "file";
          readonly label: string;
          readonly path: string;
          readonly status: FileStatus;
          readonly oldPath?: string;
      };

/**
 * Pure-data shape that `treeSpec` returns and `treeProvider` consumes.
 * Lets tests assert against the spec without constructing `vscode.TreeItem`.
 *
 * `command.args` carries the repo-relative `path` (string). `treeProvider`
 * is responsible for joining with `repoRoot` and wrapping in `vscode.Uri.file`
 * at construction time — keeping `treeSpec` free of I/O concerns.
 */
export interface TreeItemSpec {
    readonly label: string;
    /** `vscode.ThemeIcon` id (e.g. "edit", "folder"). */
    readonly iconId: string;
    readonly description?: string;
    readonly tooltip: string;
    readonly collapsibleState: "none" | "collapsed" | "expanded";
    readonly contextValue: "modifiedFile" | "modifiedFolder";
    readonly command?: { command: string; args: unknown[] };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors. (The file uses only type-level constructs so there is no runtime output to verify.)

- [ ] **Step 3: Commit**

```bash
git add src/modifiedFiles/types.ts
git commit -m "feat(modifiedFiles): add type definitions (ModifiedFile, TreeNode, TreeItemSpec)"
```

---

### Task 2: gitStatusParser (TDD)

**Files:**
- Create: `src/modifiedFiles/gitStatusParser.ts`
- Create: `test/gitStatusParser.test.ts`

**Interfaces:**
- Consumes: nothing (pure function)
- Produces: `parse(stdout: string): ModifiedFile[]`

12 test cases enumerated in spec §10. Each must be written BEFORE implementation.

- [ ] **Step 1: Write failing tests**

```typescript
// test/gitStatusParser.test.ts
import { describe, it, expect, vi } from "vitest";
import { parse } from "../src/modifiedFiles/gitStatusParser";

describe("gitStatusParser", () => {
    it("empty string returns empty array", () => {
        expect(parse("")).toEqual([]);
    });

    it("parses single modified file", () => {
        expect(parse(" M src/foo.ts")).toEqual([
            { path: "src/foo.ts", status: "M" },
        ]);
    });

    it("parses single untracked file", () => {
        expect(parse("?? new.txt")).toEqual([
            { path: "new.txt", status: "?" },
        ]);
    });

    it("parses single renamed file", () => {
        expect(parse("R  old.ts -> new.ts")).toEqual([
            { path: "new.ts", oldPath: "old.ts", status: "R" },
        ]);
    });

    it("parses single deleted file", () => {
        expect(parse(" D removed.ts")).toEqual([
            { path: "removed.ts", status: "D" },
        ]);
    });

    it("parses single added (staged) file", () => {
        expect(parse("A  staged.ts")).toEqual([
            { path: "staged.ts", status: "A" },
        ]);
    });

    it("parses mixed M+A+? in one batch", () => {
        const input = [
            " M src/foo.ts",
            "A  src/bar.ts",
            "?? baz.ts",
        ].join("\n");
        expect(parse(input)).toEqual([
            { path: "src/foo.ts", status: "M" },
            { path: "src/bar.ts", status: "A" },
            { path: "baz.ts", status: "?" },
        ]);
    });

    it("handles path with spaces", () => {
        expect(parse('M  path with space.ts')).toEqual([
            { path: "path with space.ts", status: "M" },
        ]);
    });

    it("handles path with unicode (Chinese)", () => {
        expect(parse("M  src/中文.ts")).toEqual([
            { path: "src/中文.ts", status: "M" },
        ]);
    });

    it("combines staged+unstaged M (XY='MM') as M", () => {
        expect(parse("MM src/foo.ts")).toEqual([
            { path: "src/foo.ts", status: "M" },
        ]);
    });

    it("skips garbage lines with console.warn", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const input = [
            "GARBAGE_LINE_NO_MATCH",
            " M good.ts",
        ].join("\n");
        expect(parse(input)).toEqual([
            { path: "good.ts", status: "M" },
        ]);
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });

    it("parses rename with R status in XY position", () => {
        // git porcelain uses "R " (R in index) or " R" (R in worktree)
        expect(parse("R  old.ts -> new.ts")).toEqual([
            { path: "new.ts", oldPath: "old.ts", status: "R" },
        ]);
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run test/gitStatusParser.test.ts`
Expected: All 12 tests FAIL with `parse` undefined or module-not-found errors.

- [ ] **Step 3: Implement parser**

```typescript
// src/modifiedFiles/gitStatusParser.ts
import type { ModifiedFile, FileStatus } from "./types";

/**
 * Match git porcelain v1 format:
 *   XY <path>           for status (M/A/D/?/!/ etc.)
 *   XY <old> -> <new>   for rename/copy (R/C)
 *
 * XY: index char (X) + worktree char (Y). Each may be space.
 */
const PORCELAIN_RE = /^([ MAD?!]{2})\s+(.+?)(?:\s+->\s+(.+))?$/;

export function parse(stdout: string): ModifiedFile[] {
    const out: ModifiedFile[] = [];
    for (const rawLine of stdout.split("\n")) {
        if (!rawLine) continue;
        const m = rawLine.match(PORCELAIN_RE);
        if (!m) {
            console.warn(
                `[modifiedFiles] unparseable git status line: ${JSON.stringify(rawLine)}`,
            );
            continue;
        }
        const [, xy, pathPart, arrowTarget] = m;
        const combined = combineStatus(xy[0]!, xy[1]!, pathPart, arrowTarget);
        if (combined) out.push(combined);
    }
    return out;
}

function combineStatus(
    x: string,
    y: string,
    path: string,
    arrowTarget: string | undefined,
): ModifiedFile | null {
    // Rename/copy: R anywhere in XY wins (porcelain emits "R ", " R", or "RM" etc.)
    if (x === "R" || y === "R") {
        return { path: arrowTarget ?? path, status: "R", oldPath: path };
    }
    // Untracked
    if (x === "?" && y === "?") return { path, status: "?" };
    // Worktree (Y) takes priority over staged (X) — unstaged is more visible to user
    const pri = y !== " " ? y : x;
    const status: FileStatus | null =
        pri === "M" ? "M" :
        pri === "A" ? "A" :
        pri === "D" ? "D" :
        pri === "?" ? "?" :
        pri === " " ? null :
        // Other XY (T=type-change, U=unmerged) — render as M with note in tooltip
        "M";
    return status ? { path, status } : null;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run test/gitStatusParser.test.ts`
Expected: All 12 tests PASS.

- [ ] **Step 5: Run full suite, verify no regression**

Run: `npm test`
Expected: All `444 + 12 = 456` tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modifiedFiles/gitStatusParser.ts test/gitStatusParser.test.ts
git commit -m "feat(modifiedFiles): add gitStatusParser with 12 tests"
```

---

### Task 3: treeBuilder (TDD)

**Files:**
- Create: `src/modifiedFiles/treeBuilder.ts`
- Create: `test/treeBuilder.test.ts`

**Interfaces:**
- Consumes: nothing (pure function)
- Produces: `build(files: readonly ModifiedFile[], opts: { showUntracked: boolean }): readonly TreeNode[]`

10 test cases enumerated in spec §10.

- [ ] **Step 1: Write failing tests**

```typescript
// test/treeBuilder.test.ts
import { describe, it, expect } from "vitest";
import { build } from "../src/modifiedFiles/treeBuilder";
import type { ModifiedFile, TreeNode } from "../src/modifiedFiles/types";

const file = (path: string, status: ModifiedFile["status"] = "M"): ModifiedFile =>
    ({ path, status });

describe("treeBuilder", () => {
    it("empty input returns empty array", () => {
        expect(build([], { showUntracked: true })).toEqual([]);
    });

    it("single file with no folder ancestor returns single file root", () => {
        const out = build([file("foo.ts")], { showUntracked: true });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ kind: "file", path: "foo.ts", label: "foo.ts" });
    });

    it("multiple files in same folder produce one folder containing N files", () => {
        const out = build(
            [file("src/a.ts"), file("src/b.ts"), file("src/c.ts")],
            { showUntracked: true },
        );
        expect(out).toHaveLength(1);
        const folder = out[0] as Extract<TreeNode, { kind: "folder" }>;
        expect(folder.kind).toBe("folder");
        expect(folder.label).toBe("src");
        expect(folder.children.map(c => c.label)).toEqual(["a.ts", "b.ts", "c.ts"]);
    });

    it("nested folders are inserted recursively", () => {
        const out = build(
            [file("src/plugins/foo.ts"), file("src/plugins/bar.ts")],
            { showUntracked: true },
        );
        expect(out).toHaveLength(1);
        const src = out[0] as Extract<TreeNode, { kind: "folder" }>;
        expect(src.children).toHaveLength(1);
        const plugins = src.children[0] as Extract<TreeNode, { kind: "folder" }>;
        expect(plugins.label).toBe("plugins");
        expect(plugins.children.map(c => c.label)).toEqual(["bar.ts", "foo.ts"]);
    });

    it("folder statusSummary aggregates descendants (3M+1A)", () => {
        const out = build(
            [
                file("src/a.ts", "M"),
                file("src/b.ts", "M"),
                file("src/c.ts", "M"),
                file("src/d.ts", "A"),
            ],
            { showUntracked: true },
        );
        const folder = out[0] as Extract<TreeNode, { kind: "folder" }>;
        expect(folder.statusSummary.get("M")).toBe(3);
        expect(folder.statusSummary.get("A")).toBe(1);
    });

    it("showUntracked=false hides ? files", () => {
        const out = build(
            [file("a.ts", "M"), file("b.ts", "?")],
            { showUntracked: false },
        );
        // Recursively check no file has status "?"
        const visit = (n: TreeNode): boolean => {
            if (n.kind === "file") return n.status === "?";
            return n.children.some(visit);
        };
        expect(out.some(visit)).toBe(false);
    });

    it("showUntracked=true shows ? files", () => {
        const out = build(
            [file("a.ts", "M"), file("b.ts", "?")],
            { showUntracked: true },
        );
        const visit = (n: TreeNode): boolean => {
            if (n.kind === "file") return n.status === "?";
            return n.children.some(visit);
        };
        expect(out.some(visit)).toBe(true);
    });

    it("folder node has kind='folder' and synthetic path", () => {
        const out = build([file("src/foo.ts")], { showUntracked: true });
        const folder = out[0] as Extract<TreeNode, { kind: "folder" }>;
        expect(folder.kind).toBe("folder");
        expect(folder.path).toBe("src");
    });

    it("file node has kind='file' and no children property", () => {
        const out = build([file("foo.ts")], { showUntracked: true });
        const f = out[0] as Extract<TreeNode, { kind: "file" }>;
        expect(f.kind).toBe("file");
        expect((f as { children?: unknown }).children).toBeUndefined();
    });

    it("same-level entries sorted alphabetically (folder+file not separated)", () => {
        const out = build(
            [file("zeta.ts"), file("alpha.ts"), file("mike/inside.ts")],
            { showUntracked: true },
        );
        expect(out.map(n => n.label)).toEqual(["alpha.ts", "mike", "zeta.ts"]);
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run test/treeBuilder.test.ts`
Expected: All 10 tests FAIL (module not found).

- [ ] **Step 3: Implement builder**

```typescript
// src/modifiedFiles/treeBuilder.ts
import type { FileStatus, ModifiedFile, TreeNode } from "./types";

export interface BuildOptions {
    readonly showUntracked: boolean;
}

/**
 * Convert flat list of `ModifiedFile` into a forest of `TreeNode`.
 * Folder nodes are synthetic — created only when they have modified descendants.
 *
 * @param files - flat list (typically from `gitStatusParser.parse`)
 * @param opts.showUntracked - if false, `?` files are filtered out
 * @returns top-level entries (mix of folders and files), sorted alphabetically
 */
export function build(
    files: readonly ModifiedFile[],
    opts: BuildOptions,
): readonly TreeNode[] {
    const filtered = opts.showUntracked ? files : files.filter(f => f.status !== "?");
    if (filtered.length === 0) return [];

    // Mutable working area; final cast to readonly in return.
    interface MutableFolder {
        kind: "folder";
        label: string;
        path: string;
        children: TreeNode[];
        statusSummary: Map<FileStatus, number>;
    }

    const folderIndex = new Map<string, MutableFolder>();
    const roots: TreeNode[] = [];
    const topLevelFiles: TreeNode[] = [];

    const pathSep = (s: string) => s.replace(/\\/g, "/");
    const parts = (p: string) => pathSep(p).split("/");
    const dirname = (p: string): string => {
        const segs = parts(p);
        segs.pop();
        return segs.join("/");
    };
    const basename = (p: string): string => parts(p).pop() ?? p;

    const ensureFolder = (folderPath: string, label: string): MutableFolder => {
        const existing = folderIndex.get(folderPath);
        if (existing) return existing;
        const folder: MutableFolder = {
            kind: "folder",
            label,
            path: folderPath,
            children: [],
            statusSummary: new Map(),
        };
        folderIndex.set(folderPath, folder);
        const parentPath = dirname(folderPath);
        if (parentPath) {
            const parent = ensureFolder(parentPath, basename(parentPath));
            parent.children.push(folder);
        } else {
            roots.push(folder);
        }
        return folder;
    };

    for (const f of filtered) {
        const dir = dirname(f.path);
        const fileLabel = basename(f.path);
        const fileNode: TreeNode = {
            kind: "file",
            label: fileLabel,
            path: f.path,
            status: f.status,
            ...(f.oldPath !== undefined ? { oldPath: f.oldPath } : {}),
        };
        if (dir) {
            const folder = ensureFolder(dir, basename(dir));
            folder.children.push(fileNode);
        } else {
            topLevelFiles.push(fileNode);
        }
    }

    // Compute statusSummary recursively for folders
    const computeSummary = (folder: MutableFolder): void => {
        for (const child of folder.children) {
            if (child.kind === "file") {
                folder.statusSummary.set(
                    child.status,
                    (folder.statusSummary.get(child.status) ?? 0) + 1,
                );
            } else {
                computeSummary(child as MutableFolder);
                const sub = (child as MutableFolder).statusSummary;
                for (const [k, v] of sub) {
                    folder.statusSummary.set(k, (folder.statusSummary.get(k) ?? 0) + v);
                }
            }
        }
    };
    roots.forEach(computeSummary);

    // Sort children (alphabetical, no folder/file separation)
    const sortRecursive = (node: TreeNode): void => {
        if (node.kind !== "folder") return;
        node.children.sort((a, b) => a.label.localeCompare(b.label));
        node.children.forEach(sortRecursive);
    };
    roots.forEach(sortRecursive);
    topLevelFiles.sort((a, b) => a.label.localeCompare(b.label));

    // Merge roots + top-level files, sort
    const forest: TreeNode[] = [...roots, ...topLevelFiles];
    forest.sort((a, b) => a.label.localeCompare(b.label));
    return forest;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run test/treeBuilder.test.ts`
Expected: All 10 tests PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: `444 + 12 + 10 = 466` tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modifiedFiles/treeBuilder.ts test/treeBuilder.test.ts
git commit -m "feat(modifiedFiles): add treeBuilder with 10 tests"
```

---

### Task 4: treeSpec (TDD)

**Files:**
- Create: `src/modifiedFiles/treeSpec.ts`
- Create: `test/treeSpec.test.ts`

**Interfaces:**
- Consumes: `TreeNode`
- Produces: `buildTreeItem(node: TreeNode): TreeItemSpec`

8 test cases enumerated in spec §10.

- [ ] **Step 1: Write failing tests**

```typescript
// test/treeSpec.test.ts
import { describe, it, expect } from "vitest";
import { buildTreeItem } from "../src/modifiedFiles/treeSpec";
import type { TreeNode } from "../src/modifiedFiles/types";

const folder = (
    label: string,
    children: TreeNode[],
    summary: Map<TreeNode extends { status: infer S } ? S : never, number> = new Map(),
): TreeNode => ({ kind: "folder", label, path: label, children, statusSummary: summary });

const file = (
    label: string,
    status: TreeNode extends { status: infer S } ? S : never,
    oldPath?: string,
): TreeNode => {
    const base: TreeNode = { kind: "file", label, path: label, status };
    return oldPath !== undefined ? { ...base, oldPath } : base;
};

describe("treeSpec", () => {
    it("M file → iconId 'edit', contextValue 'modifiedFile', collapsibleState 'none'", () => {
        const spec = buildTreeItem(file("a.ts", "M"));
        expect(spec.iconId).toBe("edit");
        expect(spec.contextValue).toBe("modifiedFile");
        expect(spec.collapsibleState).toBe("none");
    });

    it("A file → iconId 'add'", () => {
        expect(buildTreeItem(file("a.ts", "A")).iconId).toBe("add");
    });

    it("D file → iconId 'trash'", () => {
        expect(buildTreeItem(file("a.ts", "D")).iconId).toBe("trash");
    });

    it("? file → iconId 'question'", () => {
        expect(buildTreeItem(file("a.ts", "?")).iconId).toBe("question");
    });

    it("R file → iconId 'diff' and description 'old → label'", () => {
        const spec = buildTreeItem(file("new.ts", "R", "old.ts"));
        expect(spec.iconId).toBe("diff");
        expect(spec.description).toBe("old.ts → new.ts");
    });

    it("folder → iconId 'folder', contextValue 'modifiedFolder', collapsibleState 'collapsed'", () => {
        const spec = buildTreeItem(folder("src", []));
        expect(spec.iconId).toBe("folder");
        expect(spec.contextValue).toBe("modifiedFolder");
        expect(spec.collapsibleState).toBe("collapsed");
    });

    it("folder description uses fixed order M,A,D,R,? with only nonzero", () => {
        const f = folder("src", [], new Map([["M", 3], ["A", 1], ["D", 0], ["R", 0], ["?", 0]]));
        const spec = buildTreeItem(f);
        expect(spec.description).toBe("M 3 · A 1");
    });

    it("folder tooltip contains 'N modified files'", () => {
        const f = folder("src", [], new Map([["M", 3], ["A", 1]]));
        const spec = buildTreeItem(f);
        expect(spec.tooltip).toContain("4 modified files");
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run test/treeSpec.test.ts`
Expected: All 8 tests FAIL.

- [ ] **Step 3: Implement spec**

```typescript
// src/modifiedFiles/treeSpec.ts
import type { FileStatus, TreeItemSpec, TreeNode } from "./types";

const STATUS_ICON: Readonly<Record<FileStatus, string>> = {
    M: "edit",
    A: "add",
    D: "trash",
    R: "diff",
    "?": "question",
};

/**
 * Map `TreeNode` to a pure-data `TreeItemSpec`. The spec is consumed by
 * `treeProvider` which is responsible for converting it to `vscode.TreeItem`
 * and resolving relative paths to absolute URIs.
 *
 * Folder `command` is intentionally omitted — clicking a folder only
 * toggles expansion via the chevron.
 */
export function buildTreeItem(node: TreeNode): TreeItemSpec {
    if (node.kind === "file") {
        const description =
            node.status === "R" && node.oldPath
                ? `${node.oldPath} → ${node.label}`
                : undefined;
        const oldPathSuffix = node.oldPath ? `\nfrom: ${node.oldPath}` : "";
        return {
            label: node.label,
            iconId: STATUS_ICON[node.status],
            ...(description !== undefined ? { description } : {}),
            tooltip: `${node.path}\nstatus: ${node.status}${oldPathSuffix}`,
            collapsibleState: "none",
            contextValue: "modifiedFile",
            command: {
                command: "vscode.open",
                // Args are repo-relative path; treeProvider will resolve to absolute URI
                args: [node.path],
            },
        };
    }

    // folder
    const summaryParts: string[] = [];
    const order: FileStatus[] = ["M", "A", "D", "R", "?"];
    for (const s of order) {
        const count = node.statusSummary.get(s);
        if (count && count > 0) summaryParts.push(`${s} ${count}`);
    }
    let total = 0;
    for (const v of node.statusSummary.values()) total += v;
    const description = summaryParts.length > 0
        ? summaryParts.join(" · ")
        : `${total} files`;

    return {
        label: node.label,
        iconId: "folder",
        description,
        tooltip: `${node.path} — ${total} modified files`,
        collapsibleState: "collapsed",
        contextValue: "modifiedFolder",
    };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run test/treeSpec.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: `444 + 12 + 10 + 8 = 474` tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modifiedFiles/treeSpec.ts test/treeSpec.test.ts
git commit -m "feat(modifiedFiles): add treeSpec with 8 tests"
```

---

## Phase 2 — Orchestration + vscode-bound (depends on Phase 1)

After Phase 1 completes, Tasks 5-7 can proceed in parallel.

### Task 5: modifiedFilesStore

**Files:**
- Create: `src/modifiedFiles/modifiedFilesStore.ts`

**Interfaces:**
- Consumes: `ModifiedFile`, `ModifiedFilesStoreOptions { workspaceRoot, debounceMs, spawn, clock }`
- Produces:
  - `ModifiedFilesState = { kind: "loading" } | { kind: "ready"; nodes; files; refreshedAt } | { kind: "error"; message }`
  - `class ModifiedFilesStore` with methods: `start()`, `refresh()`, `toggleUntracked()`, `getState()`, `onDidChange(listener)`, `dispose()`

The store is largely vscode-bound (uses `vscode.workspace.createFileSystemWatcher`), so unit-testing is limited. We rely on integration verification at Task 12. The store includes a debouncer that uses `setTimeout` (injectable via options for testing in the future, but not required now).

- [ ] **Step 1: Create the store**

```typescript
// src/modifiedFiles/modifiedFilesStore.ts
import * as vscode from "vscode";
import * as gitStatusParser from "./gitStatusParser";
import * as treeBuilder from "./treeBuilder";
import type { ModifiedFile, TreeNode } from "./types";

const SCAN_TIMEOUT_MS = 10_000;

export type ModifiedFilesState =
    | { readonly kind: "loading" }
    | {
          readonly kind: "ready";
          readonly nodes: readonly TreeNode[];
          readonly files: readonly ModifiedFile[];
          readonly refreshedAt: number;
      }
    | { readonly kind: "error"; readonly message: string };

export interface SpawnResult {
    readonly stdout: string;
    readonly stderr: string;
}

export interface ModifiedFilesStoreOptions {
    readonly workspaceRoot: string;
    readonly debounceMs: number;
    /**
     * Spawns a child process. Must resolve with stdout/stderr.
     * Injected for testing; production passes `spawnExecFile` from index.ts.
     */
    readonly spawn: (cmd: string, args: readonly string[]) => Promise<SpawnResult>;
    /** Injectable clock for testing; production passes `() => Date.now()`. */
    readonly clock: () => number;
}

export type ModifiedFilesListener = (state: ModifiedFilesState) => void;

export class ModifiedFilesStore {
    private state: ModifiedFilesState = { kind: "loading" };
    private showUntracked = true; // default ON per user decision
    private readonly listeners = new Set<ModifiedFilesListener>();
    private debounceTimer: NodeJS.Timeout | undefined;
    private watcher: vscode.FileSystemWatcher | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly options: ModifiedFilesStoreOptions) {}

    /**
     * Initial population + start watching for changes. Resolves when first
     * scan completes (success or error). Errors do NOT throw — they transition
     * to `state.kind === "error"` and emit.
     */
    async start(): Promise<void> {
        await this.refresh();
        const watcher = vscode.workspace.createFileSystemWatcher("**/*");
        const onFsEvent = () => this.scheduleRefresh();
        this.disposables.push(
            watcher.onDidChange(onFsEvent),
            watcher.onDidCreate(onFsEvent),
            watcher.onDidDelete(onFsEvent),
            watcher,
        );
        this.watcher = watcher;
    }

    /**
     * Run `git status --porcelain` (with 10s timeout), parse, build tree.
     * Idempotent — safe to call multiple times. Failures land in error state.
     */
    async refresh(): Promise<void> {
        try {
            const stdout = await Promise.race([
                this.options.spawn("git", ["status", "--porcelain"]).then(r => r.stdout),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error(`git status timed out after ${SCAN_TIMEOUT_MS}ms`)),
                        SCAN_TIMEOUT_MS,
                    ),
                ),
            ]);
            const files = gitStatusParser.parse(stdout);
            const nodes = treeBuilder.build(files, { showUntracked: this.showUntracked });
            this.state = { kind: "ready", nodes, files, refreshedAt: this.options.clock() };
        } catch (err) {
            this.state = {
                kind: "error",
                message: err instanceof Error ? err.message : String(err),
            };
        }
        this.emit();
    }

    /**
     * Toggle `?` files visibility. Does NOT re-spawn git status — the parsed
     * `state.files` already contains them; just rebuilds the tree.
     */
    toggleUntracked(): void {
        this.showUntracked = !this.showUntracked;
        if (this.state.kind === "ready") {
            const nodes = treeBuilder.build(this.state.files, {
                showUntracked: this.showUntracked,
            });
            this.state = { ...this.state, nodes };
            this.emit();
        }
    }

    getState(): ModifiedFilesState {
        return this.state;
    }

    onDidChange(listener: ModifiedFilesListener): vscode.Disposable {
        this.listeners.add(listener);
        return new vscode.Disposable(() => {
            this.listeners.delete(listener);
        });
    }

    dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
        this.watcher = undefined;
        this.listeners.clear();
    }

    private scheduleRefresh(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            this.refresh().catch(err =>
                console.error("[modifiedFiles] refresh failed:", err),
            );
        }, this.options.debounceMs);
    }

    private emit(): void {
        for (const l of this.listeners) l(this.state);
    }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/modifiedFiles/modifiedFilesStore.ts
git commit -m "feat(modifiedFiles): add store with FSW debouncer + git spawn"
```

---

### Task 6: commands.ts

**Files:**
- Create: `src/modifiedFiles/commands.ts`

**Interfaces:**
- Consumes: `vscode.ExtensionContext`, `ModifiedFilesStore`, `repoRoot: string`
- Produces: `registerModifiedFilesCommands(...)`: `vscode.Disposable[]`

- [ ] **Step 1: Create commands**

```typescript
// src/modifiedFiles/commands.ts
import * as path from "path";
import * as vscode from "vscode";
import type { ModifiedFilesStore } from "./modifiedFilesStore";

export function registerModifiedFilesCommands(
    ctx: vscode.ExtensionContext,
    store: ModifiedFilesStore,
    repoRoot: string,
): vscode.Disposable[] {
    const toAbsolute = (p: string): string =>
        path.isAbsolute(p) ? p : path.join(repoRoot, p);

    return [
        vscode.commands.registerCommand("superset.modifiedFiles.refresh", () => {
            return store.refresh();
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.toggleUntracked", () => {
            store.toggleUntracked();
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.revealInExplorer", (arg?: { path: string }) => {
            if (!arg?.path) return;
            // Use revealFileInOS (cross-platform) — revealInExplorer only works for
            // files already visible in the native Explorer tree.
            vscode.commands.executeCommand(
                "revealFileInOS",
                vscode.Uri.file(toAbsolute(arg.path)),
            );
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.copyPath", (arg?: { path: string }) => {
            if (!arg?.path) return;
            vscode.env.clipboard.writeText(toAbsolute(arg.path));
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.copyRelativePath", (arg?: { path: string }) => {
            if (!arg?.path) return;
            vscode.env.clipboard.writeText(arg.path);
        }),
    ];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/modifiedFiles/commands.ts
git commit -m "feat(modifiedFiles): add command handlers (refresh, toggle, reveal, copy)"
```

---

### Task 7: treeProvider.ts

**Files:**
- Create: `src/modifiedFiles/treeProvider.ts`

**Interfaces:**
- Consumes: `ModifiedFilesStore`, `repoRoot: string`
- Produces: `class ModifiedFilesTreeProvider implements vscode.TreeDataProvider<TreeNode>` with `getTreeItem(element)`, `getChildren(element?)`, `onDidChangeTreeData` event

- [ ] **Step 1: Create provider**

```typescript
// src/modifiedFiles/treeProvider.ts
import * as vscode from "vscode";
import * as treeSpec from "./treeSpec";
import type { ModifiedFilesStore } from "./modifiedFilesStore";
import type { TreeNode } from "./types";

const COLLAPSIBLE_MAP = {
    none: vscode.TreeItemCollapsibleState.None,
    collapsed: vscode.TreeItemCollapsibleState.Collapsed,
    expanded: vscode.TreeItemCollapsibleState.Expanded,
} as const;

export class ModifiedFilesTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined> = this.emitter.event;
    private storeListener: vscode.Disposable | undefined;

    constructor(
        private readonly store: ModifiedFilesStore,
        private readonly repoRoot: string,
    ) {
        this.storeListener = store.onDidChange(state => {
            if (state.kind === "ready") this.emitter.fire(undefined);
        });
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        const spec = treeSpec.buildTreeItem(element);
        const item = new vscode.TreeItem(spec.label);
        item.iconPath = new vscode.ThemeIcon(spec.iconId);
        if (spec.description) item.description = spec.description;
        item.tooltip = spec.tooltip;
        item.collapsibleState = COLLAPSIBLE_MAP[spec.collapsibleState];
        item.contextValue = spec.contextValue;
        if (spec.command) {
            // spec.command.args carries repo-relative path as string.
            // Resolve to absolute URI and wrap in vscode.open's expected shape.
            const relPath = spec.command.args[0] as string;
            item.command = {
                command: "vscode.open",
                arguments: [vscode.Uri.file(this.absPath(relPath))],
            };
        }
        return item;
    }

    getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
        const state = this.store.getState();
        if (state.kind !== "ready") return [];
        if (!element) return [...state.nodes];
        if (element.kind === "folder") return [...element.children];
        return [];
    }

    dispose(): void {
        this.storeListener?.dispose();
        this.storeListener = undefined;
        this.emitter.dispose();
    }

    private absPath(repoRel: string): string {
        const path = require("path") as typeof import("path");
        return path.isAbsolute(repoRel) ? repoRel : path.join(this.repoRoot, repoRel);
    }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0. (Note: `require("path")` is intentionally lazy — keep treeProvider free of top-level Node imports beyond `vscode`.)

- [ ] **Step 3: Commit**

```bash
git add src/modifiedFiles/treeProvider.ts
git commit -m "feat(modifiedFiles): add TreeDataProvider with absolute path injection"
```

---

## Phase 3 — Composition (depends on Phase 2)

### Task 8: index.ts (composition root)

**Files:**
- Create: `src/modifiedFiles/index.ts`

**Interfaces:**
- Consumes: `FeatureContext` (from `src/shared.ts`)
- Produces: `register(ctx): FeatureHandle`

Includes inline `MessageOnlyProvider` (for "no workspace" / "not git repo" empty states) and `spawnExecFile` helper (production spawn wrapper).

- [ ] **Step 1: Create composition root**

```typescript
// src/modifiedFiles/index.ts
import { execFile, spawnSync } from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import { registerModifiedFilesCommands } from "./commands";
import { ModifiedFilesStore } from "./modifiedFilesStore";
import { ModifiedFilesTreeProvider } from "./treeProvider";

export function register(ctx: FeatureContext): FeatureHandle {
    const { workspaceFolder } = ctx;

    // Case 1: no workspace folder
    if (!workspaceFolder) {
        return makeMessageOnlyView(ctx, "Open a folder to use Modified Files");
    }

    // Case 2: validate git repo (synchronous — fail fast on activation)
    const fsPath = workspaceFolder.uri.fsPath;
    const repoRoot = detectGitRoot(fsPath);
    if (!repoRoot) {
        return makeMessageOnlyView(ctx, "Not a git repository");
    }

    // Case 3: normal path
    const config = ctx.shared.config;
    const debounceMs = config.get<number>("superset.modifiedFiles.debounceMs") ?? 500;

    const store = new ModifiedFilesStore({
        workspaceRoot: repoRoot,
        debounceMs,
        spawn: spawnExecFile,
        clock: () => Date.now(),
    });

    const provider = new ModifiedFilesTreeProvider(store, repoRoot);
    const view = vscode.window.createTreeView("superset.modifiedFiles", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    store.start().catch(err => {
        ctx.shared.log.error(`[modifiedFiles] start failed: ${err}`);
    });

    const cmds = registerModifiedFilesCommands(ctx.context, store, repoRoot);

    ctx.subscriptions.push(view, ...cmds, provider);
    ctx.resetHandlers.push(() => store.refresh());

    return {
        dispose: () => {
            store.dispose();
            // view and cmds are auto-disposed via ctx.subscriptions
        },
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function detectGitRoot(fsPath: string): string | null {
    try {
        const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
            cwd: fsPath,
            encoding: "utf-8",
        });
        const stdout = (result.stdout ?? "").trim();
        if (stdout && result.status === 0) return stdout;
    } catch {
        // fallthrough
    }
    return null;
}

function makeMessageOnlyView(ctx: FeatureContext, message: string): FeatureHandle {
    const provider = new MessageOnlyProvider(message);
    const view = vscode.window.createTreeView("superset.modifiedFiles", {
        treeDataProvider: provider,
    });
    ctx.subscriptions.push(view, provider);
    return { dispose: () => view.dispose() };
}

/**
 * Minimal TreeDataProvider that displays a single message. Used when the
 * panel cannot usefully render — no workspace or not a git repo.
 */
class MessageOnlyProvider implements vscode.TreeDataProvider<{ readonly message: string }> {
    private readonly emitter = new vscode.EventEmitter<{ message: string } | undefined>();
    readonly onDidChangeTreeData: vscode.Event<{ message: string } | undefined> =
        this.emitter.event;

    constructor(private readonly message: string) {}

    getTreeItem(element: { message: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.message);
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        return item;
    }

    getChildren(): { message: string }[] {
        return [{ message: this.message }];
    }

    dispose(): void {
        this.emitter.dispose();
    }
}

/**
 * Promise wrapper around child_process.execFile. Resolves with stdout/stderr
 * on success, rejects on non-zero exit. Production spawn — tests inject fakes
 * via `ModifiedFilesStoreOptions.spawn`.
 */
function spawnExecFile(
    cmd: string,
    args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(
            cmd,
            [...args],
            { maxBuffer: 16 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve({ stdout: String(stdout), stderr: String(stderr) });
            },
        );
    });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/modifiedFiles/index.ts
git commit -m "feat(modifiedFiles): add composition root with message-only fallback"
```

---

### Task 9: plugin.ts (ExtensionPlugin shim)

**Files:**
- Create: `src/modifiedFiles/plugin.ts`

**Interfaces:**
- Consumes: `ExtensionPlugin` (from `src/plugin/types.ts`), `createFeatureContext` (from `src/plugin/featureContext.ts`)
- Produces: `export const modifiedFilesPlugin: ExtensionPlugin`

- [ ] **Step 1: Create plugin shim**

```typescript
// src/modifiedFiles/plugin.ts
import { createFeatureContext } from "../plugin/featureContext";
import type { ExtensionPlugin } from "../plugin/types";
import { register } from "./index";

export const modifiedFilesPlugin: ExtensionPlugin = {
    id: "modified-files",
    name: "Modified Files",
    activate(pCtx) {
        const ctx = createFeatureContext(pCtx);
        return register(ctx);
    },
    deactivate() {
        // Disposables are tracked in pCtx; deactivate is a no-op here.
        // If we held a module-level reference, we'd dispose it here.
    },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/modifiedFiles/plugin.ts
git commit -m "feat(modifiedFiles): add ExtensionPlugin shim"
```

---

## Phase 4 — Registration (depends on Phase 3)

### Task 10: package.json + extension.ts + plugin contract test

**Files:**
- Modify: `package.json`
  - Add `views.explorer` array with `superset.modifiedFiles` entry
  - Add 5 commands (`refresh`, `toggleUntracked`, `revealInExplorer`, `copyPath`, `copyRelativePath`)
  - Add `view/title` menu entries (refresh, toggleUntracked under `view == superset.modifiedFiles`)
  - Add `view/item/context` menu entries (revealInExplorer / copyPath / copyRelativePath under `viewItem == modifiedFile`)
  - Add `configuration` section with `enabled` + `debounceMs`
  - Bump `version` from `0.10.3` to `0.10.4`
- Modify: `src/extension.ts`
  - Import `modifiedFilesPlugin` and add to the `manager.activateAll([...])` array (in the feature plugins section, after `todoPlugin` and before `globalCommandsPlugin`)
- Create: `test/modifiedFilesPlugin.test.ts`

- [ ] **Step 1: Write plugin contract test**

```typescript
// test/modifiedFilesPlugin.test.ts
import { describe, it } from "vitest";
import { modifiedFilesPlugin } from "../src/modifiedFiles/plugin";
import { assertPluginContract } from "./pluginContract.shared";

describe("modifiedFilesPlugin", () => {
    it("satisfies the ExtensionPlugin interface contract", () => {
        assertPluginContract(modifiedFilesPlugin, {
            id: "modified-files",
            name: "Modified Files",
            markdownHook: "absent",
            deactivate: "present",
        });
    });
});
```

Note: `assertPluginContract(plugin, expected)` already exists in `test/pluginContract.shared.ts` and validates: `plugin.id === expected.id`, `plugin.name === expected.name`, `plugin.contributeMarkdownIt` matches `expected.markdownHook` shape, `plugin.deactivate` matches `expected.deactivate` shape. The 3 cases from spec §10 collapse into the shared helper's assertions. `markdownHook: "absent"` is correct because `modifiedFilesPlugin` only contributes a TreeView, not a markdown-it hook. `deactivate: "present"` because the plugin shim defines `deactivate()` even though it's a no-op body.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run test/modifiedFilesPlugin.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Add plugin to extension.ts**

Open `src/extension.ts`, locate the `manager.activateAll([...])` call. Find the position of feature plugins (between `treePreviewPlugin`/`todoPreviewPlugin` and `globalCommandsPlugin`). Add a new line:

```typescript
// inside src/extension.ts
import { modifiedFilesPlugin } from "./modifiedFiles/plugin";

// in the activateAll array, between todoPlugin and globalCommandsPlugin:
modifiedFilesPlugin,
```

Concrete example (existing imports/array structure may differ slightly — verify by reading `src/extension.ts` first):

```typescript
import { modifiedFilesPlugin } from "./modifiedFiles/plugin";

// ...existing imports...

await manager.activateAll([
    treePreviewPlugin,
    todoPreviewPlugin,
    // ... other feature plugins ...
    todoPlugin,
    modifiedFilesPlugin,  // ← ADD THIS LINE
    globalCommandsPlugin,
    panelLayoutPlugin,
]);
```

- [ ] **Step 4: Update package.json**

Open `package.json` and make 5 changes:

**4a. Bump version** — change `"version": "0.10.3"` to `"version": "0.10.4"`.

**4b. Add `views.explorer`** — find the existing `"views"` block. Add a new top-level key `"explorer"` (sibling to `"superset"` and `"superset-overall"`):

```jsonc
"views": {
    "explorer": [
        {
            "id": "superset.modifiedFiles",
            "name": "Modified",
            "contextualTitle": "Modified Files",
            "visibility": "collapsed",
            "when": "workspaceFolderCount > 0 && config.superset.modifiedFiles.enabled"
        }
    ],
    "superset": [ /* ... existing ... */ ],
    "superset-overall": [ /* ... existing ... */ ]
},
```

**4c. Add 5 commands** — append to the `"commands"` array:

```jsonc
{ "command": "superset.modifiedFiles.refresh", "title": "Refresh", "icon": "$(refresh)" },
{ "command": "superset.modifiedFiles.toggleUntracked", "title": "Toggle Untracked", "icon": "$(diff-added)" },
{ "command": "superset.modifiedFiles.revealInExplorer", "title": "Reveal in Explorer", "icon": "$(folder-opened)" },
{ "command": "superset.modifiedFiles.copyPath", "title": "Copy Path", "icon": "$(copy)" },
{ "command": "superset.modifiedFiles.copyRelativePath", "title": "Copy Relative Path", "icon": "$(link)" }
```

**4d. Add menu entries** — find the `"menus"` block. Add to `"view/title"`:

```jsonc
{ "command": "superset.modifiedFiles.refresh", "when": "view == superset.modifiedFiles", "group": "navigation" },
{ "command": "superset.modifiedFiles.toggleUntracked", "when": "view == superset.modifiedFiles", "group": "navigation" }
```

Add to `"view/item/context"`:

```jsonc
{ "command": "superset.modifiedFiles.revealInExplorer", "when": "viewItem == modifiedFile", "group": "1_focus" },
{ "command": "superset.modifiedFiles.copyPath", "when": "viewItem == modifiedFile", "group": "5_copy" },
{ "command": "superset.modifiedFiles.copyRelativePath", "when": "viewItem == modifiedFile", "group": "5_copy" }
```

**4e. Add configuration** — find or add a top-level `"configuration"` block. If it doesn't exist, add:

```jsonc
"configuration": {
    "title": "Superset",
    "properties": {
        "superset.modifiedFiles.enabled": {
            "type": "boolean",
            "default": true,
            "description": "Show the Modified Files panel in VSCode's Explorer view."
        },
        "superset.modifiedFiles.debounceMs": {
            "type": "number",
            "default": 500,
            "minimum": 100,
            "maximum": 5000,
            "description": "Milliseconds to debounce file system events before re-running git status."
        }
    }
}
```

Verify JSON is valid:

Run: `node -e "require('./package.json')"`
Expected: exits 0 with no output.

- [ ] **Step 5: Run plugin contract test, verify it passes**

Run: `npx vitest run test/modifiedFilesPlugin.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite, verify no regression**

Run: `npm test`
Expected: `444 + 33 = 477` tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/extension.ts package.json test/modifiedFilesPlugin.test.ts
git commit -m "feat(modifiedFiles): register in extension.ts + package.json (5 commands, 2 menus, configuration, v0.10.4)"
```

---

## Phase 5 — Documentation

### Task 11: CLAUDE.md + CHANGELOG update

**Files:**
- Modify: `CLAUDE.md` — add a new section under "Architecture 速覽 (Architecture)" table for `src/modifiedFiles/`
- Modify: `CHANGELOG.md` — add a `## [0.10.4] - 2026-07-11` entry (create the file if it doesn't exist)

- [ ] **Step 1: Read CLAUDE.md structure**

Run: `head -100 CLAUDE.md`
Expected: shows the existing architecture overview table; locate the position to add the new row.

- [ ] **Step 2: Add row to architecture table**

Find the table in CLAUDE.md under "Architecture 速覽 (Architecture)" section that lists feature modules. Add a row for `src/modifiedFiles/`:

```markdown
| `src/modifiedFiles/`  | Explorer sub-panel: git status tree (folder hierarchy, gitignored auto-excluded) | gitStatusParser, treeBuilder, treeSpec, store, MessageOnlyProvider |
```

Verify the markdown still renders correctly:

Run: `npx markdownlint-cli2 CLAUDE.md 2>&1 | head -20`
Expected: only pre-existing violations (or none).

- [ ] **Step 3: Check if CHANGELOG.md exists**

Run: `ls -la CHANGELOG.md 2>&1`
Expected: either exists or doesn't. If doesn't exist, create it.

- [ ] **Step 4: Add CHANGELOG entry**

If file doesn't exist, create with:

```markdown
# Changelog

All notable changes to Superset are documented in this file.

## [0.10.4] - 2026-07-11

### Added
- New `Modified Files` panel registered in VSCode's built-in Explorer view
- Lists modified, staged, deleted, renamed, and untracked files (excluding `.gitignore` via `git status --porcelain`)
- Folder-hierarchy tree (synthetic folder nodes; click file to open)
- FSW-debounced refresh (default 500ms, configurable via `superset.modifiedFiles.debounceMs`)
- Toggleable untracked visibility (default ON)
- Read-only actions: `Reveal in OS File Manager`, `Copy Path`, `Copy Relative Path`
- New configuration: `superset.modifiedFiles.enabled` (boolean)

### Test coverage
- 33 new test cases across `gitStatusParser`, `treeBuilder`, `treeSpec`, and plugin contract
```

If file exists, prepend the new version section above any existing entries.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs(modifiedFiles): document architecture row + 0.10.4 CHANGELOG entry"
```

---

## Phase 6 — Verification (depends on Phase 4 + Phase 5)

### Task 12: Final verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all `477` tests pass (444 existing + 33 new).

- [ ] **Step 3: Build the VSIX**

Run: `npm run build`
Expected: produces `superset-0.10.4.vsix` (or similar) in repo root. Build script: `npm run clean && npm install && tsc && npx @vscode/vsce package && bash scripts/verify-vsix.sh`.

- [ ] **Step 4: Manual smoke test**

Open VSCode Extension Development Host:

Run: `code --extensionDevelopmentPath=$(pwd) /path/to/some/git/repo`

Verify (per spec §11):
1. Explorer shows "Modified" view (collapsed by default). Expand it.
2. Tree lists modified files; folder nodes show `M N · A N` summaries.
3. Untracked files appear by default (toggleable via toolbar button).
4. Click a file row → editor opens the file.
5. Right-click → Reveal in Explorer → OS file manager opens to file location.
6. Right-click → Copy Path → clipboard has absolute path; Copy Relative Path → repo-relative.
7. In a non-git folder: tree shows "Not a git repository".
8. Touch `.gitignore` line for `dist/`; build some files there → they don't appear.
9. Edit a tracked file → panel refreshes within ~1 second.

- [ ] **Step 5: Final commit**

If all checks pass and no fixes were needed:

```bash
git status
```

Expected: working tree clean.

If fixes were needed during verification, commit them with descriptive messages:

```bash
git add -A
git commit -m "fix(modifiedFiles): <describe fix>"
```

---

## Self-review checklist (run before declaring plan complete)

- [ ] All 12 sections of spec covered:
  - §1 gitStatusParser → Task 2
  - §2 treeBuilder → Task 3
  - §3 treeSpec → Task 4
  - §4 store → Task 5
  - §5 treeProvider → Task 7
  - §6 commands → Task 6
  - §7 plugin wiring (index.ts + plugin.ts) → Tasks 8-9
  - §8 extension.ts registration → Task 10
  - §9 package.json (5 commands + menus + configuration + version) → Task 10
  - §10 test plan (33 cases) → Tasks 2-4 (30 cases) + Task 10 (3 plugin contract cases)
  - §11 verification → Task 12
- [ ] No placeholders, no "TBD", no "implement later"
- [ ] All step code blocks are complete and copy-pasteable
- [ ] Type names consistent: `ModifiedFile`, `TreeNode`, `TreeItemSpec`, `ModifiedFilesStore`, `ModifiedFilesTreeProvider`, `ModifiedFilesState` — all match between tasks
- [ ] Test count arithmetic: 12 + 10 + 8 + 3 = 33 ✓
- [ ] Existing test count consistent: 444 (from `CLAUDE.md`) used everywhere

---

## Execution notes

- **Parallel execution opportunity**: Tasks 1-4 (Phase 1) can run in parallel via separate subagents since they touch independent files. Tasks 5-7 (Phase 2) can also run in parallel after Phase 1.
- **Sequential dependencies**: Task 8 needs Tasks 5, 6, 7 complete. Task 9 needs Task 8. Task 10 needs Phase 3 complete. Task 12 needs all prior phases.
- **Estimated effort**: ~12 tasks × ~5-15 minutes each = 1-3 hours total.
- **Recommended execution mode**: subagent-driven-development (one subagent per task with review between tasks), per the project's `shuk-implements-in-parallel` preference (see memory).