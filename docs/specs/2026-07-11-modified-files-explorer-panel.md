# Modified Files Explorer Panel

## Context (為何要做)

VSCode 內建 Source Control panel 顯示 git 變動,但其樹狀結構按 `Changes / Staged Changes` 分類,不保留**資料夾階層**。對程式設計師而言,看到「`src/plugins/modifiedFiles/store.ts` 改了」比「Modified: 5 files」更有方向感 — 因為心智模型是「我想看某個 module 是不是還在改」。

`Superset` 已在 Explorer 上方提供 mDNS / Topology / Terminals / TODO 等獨立面板,**但沒有任何面板**把「目前工作區所有 modified 檔案」按資料夾階層列出。`.gitignore` 在這個情境下屬於「需要排除的雜訊」(例如使用者編輯了 `node_modules/foo.js` 的本地 patch 不算 work-in-progress)。

> 此面板**不取代** Source Control;它提供**資料夾階層視角**這個互補觀察角度。

### 使用者已確認的設計決策
1. **Container = VSCode 內建 Explorer**:`package.json` 的 `views.explorer` 加 `superset.modifiedFiles` view,出現在 Explorer 視圖最下方 (OPEN EDITORS / project tree / OUTLINE / TIMELINE 之後)
2. **Untracked 預設 ON**:使用者進 panel 就能看到所有未 tracked 新檔,符合「Modified Files」字面意義;可在工具列 toggle 為 OFF
3. **Refresh = FSW debounce + git status spawn**:`vscode.workspace.createFileSystemWatcher` 訂閱 workspace,debounce 500ms 後 spawn `git status --porcelain`
4. **Action scope = read-only navigation**:點 row 開檔、右鍵 Reveal in Explorer / Copy Path / Copy Relative Path — 不做 stage / unstage / discard
5. **資料夾節點 = 合成虛擬節點**:git 是 single source of truth,folder node 只在有 modified 子孫時存在,點擊純展開/收合

### 不做
- Stage / Unstage / Discard 操作 (交給 Source Control panel)
- 多 repo workspace 處理 (YAGNI:multi-root 是少見場景)
- 自寫 gitignore parser (git 已經處理 nested `.gitignore`、`.git/info/exclude`、global ignore,直接吃 `git status --porcelain` 的結果)
- Diff preview / Open Changes (VSCode diff editor)
- 把 panel 同步到 Activity Bar (污染既有 SuperSet 圖示)

---

## Architecture (架構)

```tree
package.json views.explorer
        ↓ activate
ExtensionPlugin (modifiedFiles)
        ↓ register()
FeatureContext
        │
        ├── modifiedFilesStore ──> spawn `git rev-parse --show-toplevel`
        │   ├── validate is-git-repo
        │   ├── spawn `git status --porcelain` ──> gitStatusParser.parse()
        │   │                                  ↓
        │   │                              ModifiedFile[]
        │   │                                  ↓
        │   ├── treeBuilder.build(files, showUntracked)
        │   │                                  ↓
        │   └── TreeNode[] forest
        │       │
        │       ├── FSW debouncer (500ms)
        │       └── showUntracked flag (toggle via command)
        │
        ├── ModifiedFilesTreeProvider (vscode.TreeDataProvider)
        │       │
        │       └── vscode.window.createTreeView("superset.modifiedFiles")
        │
        └── commands
            ├── refresh ───────────> store.refresh()
            ├── toggleUntracked ──> store.toggleUntracked()
            ├── revealInExplorer ─> vscode.revealFileInOS / revealInExplorer
            ├── copyPath ─────────> clipboard.writeText(absolutePath)
            └── copyRelativePath ─> clipboard.writeText(repoRelative)
```

兩個純函式模組 `gitStatusParser` 與 `treeBuilder` 對齊 `mdns/parser.ts`、`topology/transformer.ts` 風格 — 無 `vscode` import、可直接 vitest 單元測試。

---

## Critical files

- `src/modifiedFiles/plugin.ts` **(新)** — `ExtensionPlugin` shim,id=`"modified-files"`
- `src/modifiedFiles/index.ts` **(新)** — `register(ctx: FeatureContext)` composition 入口
- `src/modifiedFiles/modifiedFilesStore.ts` **(新)** — state + FSW + git spawn 編排
- `src/modifiedFiles/gitStatusParser.ts` **(新)** — 純函式 porcelain parser
- `src/modifiedFiles/treeBuilder.ts` **(新)** — 純函式 path list → folder tree
- `src/modifiedFiles/treeProvider.ts` **(新)** — `vscode.TreeDataProvider<TreeNode>`
- `src/modifiedFiles/treeSpec.ts` **(新)** — 純函式 `TreeNode → TreeItem spec`
- `src/modifiedFiles/types.ts` **(新)** — `ModifiedFile` / `FileStatus` / `TreeNode` / `TreeItemSpec`
- `src/modifiedFiles/commands.ts` **(新)** — `registerModifiedFilesCommands`
- `src/extension.ts` — plugin 陣列加 `modifiedFilesPlugin`
- `package.json` — `views.explorer` + 5 個 commands + 工具列 menu + context menu + configuration
- `docs/specs/` — 本檔
- `CLAUDE.md` — 新增「Modified Files Explorer Panel」段

新測試:
- `test/gitStatusParser.test.ts` **(新,~12 case)**
- `test/treeBuilder.test.ts` **(新,~10 case)**
- `test/treeSpec.test.ts` **(新,~8 case)**
- `test/modifiedFilesPlugin.test.ts` **(新,3 case 介面契約)**

---

## Data Model

### `ModifiedFile` (`src/modifiedFiles/types.ts`)

```ts
export type FileStatus = "M" | "A" | "D" | "R" | "?";

export interface ModifiedFile {
    /** Repo-relative POSIX path, e.g. "src/foo/bar.ts" */
    readonly path: string;
    /** Git porcelain status: M/A/D/R (tracked) or ? (untracked) */
    readonly status: FileStatus;
    /** Only set when status === "R" (rename/copy). Old path in repo. */
    readonly oldPath?: string;
}
```

### `TreeNode` (`src/modifiedFiles/types.ts`)

```ts
export type TreeNode =
    | { readonly kind: "folder"; readonly label: string; readonly path: string;
        readonly children: readonly TreeNode[];
        readonly statusSummary: ReadonlyMap<FileStatus, number>; }
    | { readonly kind: "file"; readonly label: string; readonly path: string;
        readonly status: FileStatus; readonly oldPath?: string; };
```

**`statusSummary` 預計算**:folder 內每個 status 的計數,給 `treeSpec` 渲染 `M 3 · A 1` description;避免 `treeSpec` 重算。

### `TreeItemSpec` (`src/modifiedFiles/treeSpec.ts`)

```ts
export interface TreeItemSpec {
    readonly label: string;
    readonly iconId: string;             // ThemeIcon id, e.g. "edit"
    readonly description?: string;
    readonly tooltip: string;
    readonly collapsibleState: "none" | "collapsed" | "expanded";
    readonly contextValue: "modifiedFile" | "modifiedFolder";
    readonly command?: { command: string; args: unknown[] };
}
```

`TreeItemSpec` 為純資料形狀,`treeProvider` 負責把它轉成 `vscode.TreeItem`(避免測試需要 mock `vscode.TreeItem`)。

---

## 1. Pure parser — `src/modifiedFiles/gitStatusParser.ts` (新)

對齊 `mdns/parser.ts` 風格:純函式、無 `vscode` import、無 I/O。

```ts
const PORCELAIN_RE = /^([ MAD?!]{2})\s+(.*?)(?:\s+->\s+(.*))?$/;

export function parse(stdout: string): ModifiedFile[] {
    const out: ModifiedFile[] = [];
    for (const rawLine of stdout.split("\n")) {
        if (!rawLine) continue;
        const m = rawLine.match(PORCELAIN_RE);
        if (!m) {
            // garbage 行:console.warn + 跳過,不擋整批
            console.warn(`[modifiedFiles] unparseable git status line: ${JSON.stringify(rawLine)}`);
            continue;
        }
        const [, xy, pathPart, arrowTarget] = m;
        // XY 兩個字元的語意:
        //   index char (X) = staged status
        //   worktree char (Y) = unstaged status
        // 對 Modified Files panel 我們需要「綜合狀態」:
        //   - 任一為 M/A/D/R 視為該狀態
        //   - 兩者都為 ?? 視為 untracked
        //   - 兩者都為 !! 視為 ignored (不會出現 --porcelain 不加 --ignored)
        const combined = combineStatus(xy[0]!, xy[1]!, pathPart, arrowTarget);
        if (combined) out.push(combined);
    }
    return out;
}

function combineStatus(x: string, y: string, path: string, arrowTarget: string | undefined): ModifiedFile | null {
    // R / C 表 rename / copy;只挑 R,因為面板不區分 copy
    if (x === "R" || y === "R") {
        return { path: arrowTarget ?? path, status: "R", oldPath: path };
    }
    // Y 是工作區狀態優先 (未 staged 的修改對使用者最直觀)
    const unstaged = y;
    const staged = x;
    if (unstaged === "M") return { path, status: "M" };
    if (staged === "M") return { path, status: "M" };
    if (unstaged === "D") return { path, status: "D" };
    if (staged === "D") return { path, status: "D" };
    if (unstaged === "A") return { path, status: "A" };
    if (staged === "A") return { path, status: "A" };
    if (x === "?" && y === "?") return { path, status: "?" };
    // 其他 (TUUU 等) 罕見,當 M 處理
    if (unstaged !== " ") return { path, status: "M" };
    return null;
}
```

### 為何不在 parser 做 gitignore 過濾
`git status --porcelain` 預設**已排除** gitignored 檔(無論是 tracked + ignored 還是完全 untracked + ignored 都不會出現)。所以 parser 收到的 list 就是「gitignore 過濾後」的結果,零成本。

### 為何 `R` 優先於其他 status
Porcelain 中 rename 同時帶 `RM` / `RD` 等,XY 兩字元可能不同。我們只看 R flag,忽略其他細節。

---

## 2. Pure tree builder — `src/modifiedFiles/treeBuilder.ts` (新)

對齊 `topology/transformer.ts` 風格:純函式、無 `vscode` import、無 I/O。

```ts
export interface BuildOptions {
    readonly showUntracked: boolean;
}

export function build(files: readonly ModifiedFile[], opts: BuildOptions): readonly TreeNode[] {
    const filtered = opts.showUntracked ? files : files.filter(f => f.status !== "?");
    if (filtered.length === 0) return [];

    // 第一步:建立 path → folder node 索引,遞迴建出所有 ancestor folder
    const folderIndex = new Map<string, { node: TreeNode; children: TreeNode[] }>();
    const roots: TreeNode[] = [];
    const ensureFolder = (folderPath: string, label: string): TreeNode => {
        const existing = folderIndex.get(folderPath);
        if (existing) return existing.node;
        const node: TreeNode = {
            kind: "folder", label, path: folderPath,
            children: [], statusSummary: new Map(),
        };
        folderIndex.set(folderPath, { node, children: node.children as TreeNode[] });
        const parentPath = dirname(folderPath);
        if (parentPath && parentPath !== ".") {
            const parent = ensureFolder(parentPath, basename(parentPath));
            (folderIndex.get(parentPath)!.children as TreeNode[]).push(node);
        } else {
            roots.push(node);
        }
        return node;
    };

    const fileNodes: TreeNode[] = [];
    for (const f of filtered) {
        const dir = dirname(f.path);
        const fileLabel = basename(f.path);
        const fileNode: TreeNode = {
            kind: "file", label: fileLabel, path: f.path,
            status: f.status, oldPath: f.oldPath,
        };
        if (dir && dir !== ".") {
            const folder = ensureFolder(dir, basename(dir));
            (folderIndex.get(dir)!.children as TreeNode[]).push(fileNode);
        } else {
            fileNodes.push(fileNode);
        }
    }

    // 第二步:children 排序 (字母序,file 與 folder 不分組,與 Explorer 慣例一致)
    const sortChildren = (n: TreeNode) => {
        if (n.kind !== "folder") return;
        n.children.sort((a, b) => a.label.localeCompare(b.label));
        n.children.forEach(sortChildren);
    };
    [...roots, ...fileNodes].forEach(sortChildren);

    // 第三步:為每個 folder 預計算 statusSummary
    const computeSummary = (n: TreeNode): Map<FileStatus, number> => {
        const summary = new Map<FileStatus, number>();
        if (n.kind === "folder") {
            for (const c of n.children) {
                if (c.kind === "file") {
                    summary.set(c.status, (summary.get(c.status) ?? 0) + 1);
                } else {
                    const sub = computeSummary(c);
                    for (const [k, v] of sub) {
                        summary.set(k, (summary.get(k) ?? 0) + v);
                    }
                }
            }
            // 用 spread 把 readonly Map 替換 (因 builder 內部 mutation 是 ok 的)
            (n as { statusSummary: Map<FileStatus, number> }).statusSummary = summary;
        }
        return summary;
    };
    roots.forEach(computeSummary);

    // roots + 頂層檔案混合排序
    const forest: TreeNode[] = [...roots, ...fileNodes];
    forest.sort((a, b) => a.label.localeCompare(b.label));
    return forest;
}
```

### 設計細節
- **Folder node path 是絕對 repo-relative path**(例 `src/plugins`);`label` 只是最後一段(`plugins`)。`treeSpec` 顯示 label,`tooltip` 用 path。
- **頂層檔案與 folder 混合排序** — 與原生 Explorer 字母序一致。
- **Mutable folder node 重建 readonly**:`computeSummary` 在 mutation 後 cast 回 readonly;這是 builder 內部的中間狀態,API 對外仍是 immutable。
- **`showUntracked=false` 過濾在第一階段做**:後續不需處理,簡化邏輯。

---

## 3. Pure spec — `src/modifiedFiles/treeSpec.ts` (新)

```ts
const STATUS_ICON: Readonly<Record<FileStatus, string>> = {
    M: "edit",
    A: "add",
    D: "trash",
    R: "diff",
    "?": "question",
};

export function buildTreeItem(node: TreeNode): TreeItemSpec {
    if (node.kind === "file") {
        const icon = STATUS_ICON[node.status];
        const description = node.status === "R" && node.oldPath
            ? `${node.oldPath} → ${node.label}`
            : undefined;
        return {
            label: node.label,
            iconId: icon,
            description,
            tooltip: `${node.path}\nstatus: ${node.status}${node.oldPath ? `\nfrom: ${node.oldPath}` : ""}`,
            collapsibleState: "none",
            contextValue: "modifiedFile",
            command: {
                command: "vscode.open",
                args: [{ scheme: "file", path: node.path }],  // 絕對路徑由 store 注入 prefix
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
    const total = Array.from(node.statusSummary.values()).reduce((a, b) => a + b, 0);

    return {
        label: node.label,
        iconId: "folder",
        description: summaryParts.join(" · ") || `${total} files`,
        tooltip: `${node.path} — ${total} modified files`,
        collapsibleState: "collapsed",
        contextValue: "modifiedFolder",
    };
}
```

**`vscode.open` 路徑注入**:`command` args 不能直接用絕對路徑的字串格式(那會被當作 workspace 相對)。Store 在 spawn git status 前就把 repo root 記下,絕對路徑 = `${repoRoot}/${relative}`。`treeSpec` 對此無感知 — 它的 spec 寫相對路徑(因為 `build` 函式純函式不該有 I/O);**實際 `vscode.open` 的 args 在 `treeProvider.getTreeItem` 階段補上絕對 prefix**(見 §5)。

---

## 4. Store — `src/modifiedFiles/modifiedFilesStore.ts` (新)

```ts
export interface ModifiedFilesStoreOptions {
    readonly workspaceRoot: string;          // 已驗證為 git repo root
    readonly debounceMs: number;
    readonly spawn: (cmd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
    readonly clock: () => number;
}

export type ModifiedFilesState =
    | { kind: "loading" }
    | { kind: "ready"; nodes: readonly TreeNode[]; files: readonly ModifiedFile[]; refreshedAt: number }
    | { kind: "error"; message: string };

export class ModifiedFilesStore {
    private state: ModifiedFilesState = { kind: "loading" };
    private showUntracked = true;             // 預設 ON (per user decision)
    private readonly listeners = new Set<(s: ModifiedFilesState) => void>();
    private debounceTimer: NodeJS.Timeout | undefined;
    private watcher: vscode.FileSystemWatcher | undefined;
    // ...

    async start(): Promise<void> {
        await this.refresh();
        this.watcher = vscode.workspace.createFileSystemWatcher("**/*");
        const onChange = () => this.scheduleRefresh();
        this.watcher.onDidChange(onChange);
        this.watcher.onDidCreate(onChange);
        this.watcher.onDidDelete(onChange);
    }

    private scheduleRefresh(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            this.refresh().catch(err => console.error("[modifiedFiles] refresh failed:", err));
        }, this.options.debounceMs);
    }

    async refresh(): Promise<void> {
        const SCAN_TIMEOUT_MS = 10_000;
        try {
            const stdout = await Promise.race([
                this.options.spawn("git", ["status", "--porcelain"]).then(r => r.stdout),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`git status timed out after ${SCAN_TIMEOUT_MS}ms`)), SCAN_TIMEOUT_MS)
                ),
            ]);
            const files = gitStatusParser.parse(stdout);
            const nodes = treeBuilder.build(files, { showUntracked: this.showUntracked });
            this.state = { kind: "ready", nodes, files, refreshedAt: this.options.clock() };
        } catch (err) {
            this.state = { kind: "error", message: err instanceof Error ? err.message : String(err) };
        }
        this.emit();
    }

    toggleUntracked(): void {
        this.showUntracked = !this.showUntracked;
        // 不重跑 git status,直接重建 nodes
        if (this.state.kind === "ready") {
            const nodes = treeBuilder.build(this.state.files, { showUntracked: this.showUntracked });
            this.state = { ...this.state, nodes };
            this.emit();
        }
    }

    // listener pattern 同其他 store
}
```

### 為何 `toggleUntracked` 不重跑 git status
已 parse 過的 `files` 包含 `??` 條目,只是被 `treeBuilder.build({ showUntracked: false })` 過濾掉。切換 flag 後純函式 rebuild 即可,無 spawn。

### 為何 watcher 用 `**/*` glob
VSCode 的 FSW 不支援 gitignore 等價過濾。Build / IDE 自動寫入 `node_modules/`、`dist/` 會大量觸發,debounce 500ms window 兜底。Trade-off 接受。

---

## 5. TreeProvider — `src/modifiedFiles/treeProvider.ts` (新)

```ts
export class ModifiedFilesTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;

    constructor(
        private readonly store: ModifiedFilesStore,
        private readonly repoRoot: string,
    ) {
        store.onDidChange(s => {
            if (s.kind === "ready") this.emitter.fire(undefined);  // 全樹重繪
        });
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        const spec = treeSpec.buildTreeItem(element);
        const item = new vscode.TreeItem(spec.label);
        item.iconPath = new vscode.ThemeIcon(spec.iconId);
        if (spec.description) item.description = spec.description;
        item.tooltip = spec.tooltip;
        item.collapsibleState = spec.collapsibleState === "none"
            ? vscode.TreeItemCollapsibleState.None
            : spec.collapsibleState === "expanded"
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed;
        item.contextValue = spec.contextValue;
        if (spec.command) {
            // spec.command.args 帶的是 repo-relative path,在此注入絕對 prefix
            const absPath = `${this.repoRoot}/${element.path}`;
            item.command = {
                command: spec.command.command,
                arguments: [vscode.Uri.file(absPath)],
            };
        }
        return item;
    }

    getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
        const state = this.store.getState();
        if (state.kind !== "ready") {
            if (state.kind === "error") return [];   // 顯示 errorMessage via store message
            return [];
        }
        if (!element) return state.nodes as TreeNode[];
        return element.kind === "folder" ? [...element.children] : [];
    }
}
```

---

## 6. Commands — `src/modifiedFiles/commands.ts` (新)

```ts
export function registerModifiedFilesCommands(
    ctx: vscode.ExtensionContext,
    store: ModifiedFilesStore,
    repoRoot: string,
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand("superset.modifiedFiles.refresh", () => {
            return store.refresh();
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.toggleUntracked", () => {
            store.toggleUntracked();
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.revealInExplorer", (arg?: { path: string }) => {
            if (!arg?.path) return;
            const abs = path.isAbsolute(arg.path) ? arg.path : path.join(repoRoot, arg.path);
            vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(abs));
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.copyPath", (arg?: { path: string }) => {
            if (!arg?.path) return;
            const abs = path.isAbsolute(arg.path) ? arg.path : path.join(repoRoot, arg.path);
            vscode.env.clipboard.writeText(abs);
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.copyRelativePath", (arg?: { path: string }) => {
            if (!arg?.path) return;
            vscode.env.clipboard.writeText(arg.path);
        }),
    ];
}
```

**`revealInExplorer` 選 `revealFileInOS`**:`revealInExplorer` 是 VSCode 內建命令,**只**對當前 Explorer tree 已顯示的檔有效;modified files 是另一個 tree,跳過去會找不到。`revealFileInOS` 呼叫 OS 檔案總管(finder / explorer.exe / nautilus),跨平台一致。

---

## 7. Plugin wiring — `src/modifiedFiles/index.ts` + `plugin.ts` (新)

```ts
// plugin.ts
import type { ExtensionPlugin } from "../plugin";
import { createFeatureContext } from "../plugin/featureContext";
import { register } from "./index";

export const modifiedFilesPlugin: ExtensionPlugin = {
    id: "modified-files",
    name: "Modified Files",
    activate(pCtx) {
        const ctx = createFeatureContext(pCtx);
        return register(ctx);
    },
    deactivate() { /* handled by disposable collected in register */ },
};
```

```ts
// index.ts
export function register(ctx: FeatureContext): FeatureHandle {
    const { workspaceFolder } = ctx;
    if (!workspaceFolder) {
        // no workspace → 空 panel + "Open a folder to use Modified Files"
        const provider = new MessageOnlyProvider("Open a folder to use Modified Files");
        const view = vscode.window.createTreeView("superset.modifiedFiles", { treeDataProvider: provider });
        ctx.subscriptions.push(view);
        return { dispose: () => view.dispose() };
    }

    // 同步驗證 git repo (錯誤立即回報,不卡 extension 啟動)
    let isGit = false;
    let repoRoot = workspaceFolder.uri.fsPath;
    try {
        const { stdout } = spawnSync("git", ["rev-parse", "--show-toplevel"], {
            cwd: workspaceFolder.uri.fsPath,
            encoding: "utf-8",
        });
        if (stdout.trim()) {
            isGit = true;
            repoRoot = stdout.trim();
        }
    } catch {
        isGit = false;
    }

    if (!isGit) {
        const provider = new MessageOnlyProvider("Not a git repository");
        const view = vscode.window.createTreeView("superset.modifiedFiles", { treeDataProvider: provider });
        ctx.subscriptions.push(view);
        return { dispose: () => view.dispose() };
    }

    // 正常路徑
    const store = new ModifiedFilesStore({
        workspaceRoot: repoRoot,
        debounceMs: ctx.shared.config.get<number>("superset.modifiedFiles.debounceMs") ?? 500,
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
    ctx.subscriptions.push(view, ...cmds);
    ctx.resetHandlers.push(() => store.refresh());

    return {
        dispose: () => {
            view.dispose();
            cmds.forEach(d => d.dispose());
        },
    };
}

/**
 * Minimal TreeDataProvider that displays a single message (used when
 * the panel can't usefully render — no workspace, or not a git repo).
 * VSCode renders `getChildren()[0]` as the empty-state message.
 */
class MessageOnlyProvider implements vscode.TreeDataProvider<{ readonly message: string }> {
    constructor(private readonly message: string) {}
    private readonly emitter = new vscode.EventEmitter<{ message: string } | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;
    getTreeItem(element: { message: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.message);
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        return item;
    }
    getChildren(): { message: string }[] {
        return [{ message: this.message }];
    }
}

/**
 * Thin Promise wrapper around child_process.execFile. Resolves with
 * `{ stdout, stderr }` like `execFile`'s callback, rejects on non-zero exit.
 * Lives at module scope (not in store) so unit tests can inject a fake.
 */
function spawnExecFile(cmd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(cmd, [...args], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve({ stdout: String(stdout), stderr: String(stderr) });
        });
    });
}
```

---

## 8. `src/extension.ts` 整合

plugin 陣列加 `modifiedFilesPlugin`(在 feature plugins 段,todoPlugin 之後):

```ts
import { modifiedFilesPlugin } from "./modifiedFiles/plugin";

await manager.activateAll([
    treePreviewPlugin,
    todoPreviewPlugin,
    // ... 既有 feature plugins
    modifiedFilesPlugin,   // ← 新增
    globalCommandsPlugin,
    panelLayoutPlugin,     // 仍是 last
]);
```

---

## 9. `package.json` updates

### `views.explorer` 新增 view

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
    // ...既有 superset / superset-overall 不變
}
```

### 5 個新 commands

```jsonc
{ "command": "superset.modifiedFiles.refresh", "title": "Refresh", "icon": "$(refresh)" },
{ "command": "superset.modifiedFiles.toggleUntracked", "title": "Toggle Untracked", "icon": "$(diff-added)" },
{ "command": "superset.modifiedFiles.revealInExplorer", "title": "Reveal in Explorer", "icon": "$(folder-opened)" },
{ "command": "superset.modifiedFiles.copyPath", "title": "Copy Path", "icon": "$(copy)" },
{ "command": "superset.modifiedFiles.copyRelativePath", "title": "Copy Relative Path", "icon": "$(link)" }
```

### Menu entries

```jsonc
"menus": {
    "view/title": [
        { "command": "superset.modifiedFiles.refresh", "when": "view == superset.modifiedFiles", "group": "navigation" },
        { "command": "superset.modifiedFiles.toggleUntracked", "when": "view == superset.modifiedFiles", "group": "navigation" }
    ],
    "view/item/context": [
        { "command": "superset.modifiedFiles.revealInExplorer", "when": "viewItem == modifiedFile", "group": "1_focus" },
        { "command": "superset.modifiedFiles.copyPath", "when": "viewItem == modifiedFile", "group": "5_copy" },
        { "command": "superset.modifiedFiles.copyRelativePath", "when": "viewItem == modifiedFile", "group": "5_copy" }
    ]
}
```

### Configuration

```jsonc
"configuration": {
    "title": "Superset",
    "properties": {
        "superset.modifiedFiles.enabled": {
            "type": "boolean", "default": true,
            "description": "Show the Modified Files panel in VSCode's Explorer view."
        },
        "superset.modifiedFiles.debounceMs": {
            "type": "number", "default": 500, "minimum": 100, "maximum": 5000,
            "description": "Milliseconds to debounce file system events before re-running git status."
        }
    }
}
```

### 版本 bump

`"version": "0.10.3"` → `"0.10.4"` (patch,純增量功能,公開介面零變化)。

---

## 10. Test plan

### New: `test/gitStatusParser.test.ts` (~12 case)

| # | Case |
|---|---|
| 1 | 空字串 → `[]` |
| 2 | 單 modified `" M src/foo.ts"` → `[{ path: "src/foo.ts", status: "M" }]` |
| 3 | 單 untracked `"?? new.txt"` → `[{ path: "new.txt", status: "?" }]` |
| 4 | 單 renamed `"R  old.ts -> new.ts"` → `[{ path: "new.ts", oldPath: "old.ts", status: "R" }]` |
| 5 | 單 deleted `" D removed.ts"` → `[{ path: "removed.ts", status: "D" }]` |
| 6 | 單 added staged `"A  staged.ts"` → `[{ path: "staged.ts", status: "A" }]` |
| 7 | mixed M+A+?? in one batch → 3 筆獨立 |
| 8 | 路徑含空格 `"M  path with space.ts"` |
| 9 | 路徑含中文 `"M  src/中文.ts"` |
| 10 | XY 同時有值 `"MM src/foo.ts"` (staged+unstaged both M) → `{ status: "M" }` |
| 11 | garbage 行 → console.warn + 跳過,不擋整批 |
| 12 | rename 帶 `"RM old -> new"` → `{ path: "new", oldPath: "old", status: "R" }` |

### New: `test/treeBuilder.test.ts` (~10 case)

| # | Case |
|---|---|
| 1 | 空 input → `[]` |
| 2 | 單檔無 folder ancestor → `[file]` (forest = 1 file root) |
| 3 | 多檔同 folder → `[folder[file×N]]` |
| 4 | 巢狀 folder → 正確遞迴插入 (sub-folder in folder) |
| 5 | Folder `statusSummary`: 3M + 1A → `Map { M: 3, A: 1 }` |
| 6 | `showUntracked=false` → `?` 檔不出現在 forest 任何位置 |
| 7 | `showUntracked=true` → `?` 檔出現 |
| 8 | Folder node `kind === "folder"`、`isSynthetic`(由 path 反推,test 驗 `path === "src"` 等) |
| 9 | File node `kind === "file"`、無 `children` 屬性 |
| 10 | 同一層 5 個 entry 按 `label` 字母排序 (file 與 folder 不分組) |

### New: `test/treeSpec.test.ts` (~8 case)

| # | Case |
|---|---|
| 1 | File M → iconId `"edit"`、contextValue `"modifiedFile"`、collapsibleState `"none"` |
| 2 | File A → iconId `"add"` |
| 3 | File D → iconId `"trash"` |
| 4 | File ? → iconId `"question"` |
| 5 | File R → iconId `"diff"`、description = `"old → label"` |
| 6 | Folder → iconId `"folder"`、contextValue `"modifiedFolder"`、collapsibleState `"collapsed"` |
| 7 | Folder description 順序固定:`M N · A N · D N · R N · ? N`(只列非零) |
| 8 | Folder tooltip 含 `"N modified files"` |

### New: `test/modifiedFilesPlugin.test.ts` (3 case 介面契約)

對齊 `test/pluginContract.shared.ts` 的 `assertPluginContract` 共用 helper:

| # | Case |
|---|---|
| 1 | `id === "modified-files"`、`name === "Modified Files"` |
| 2 | `activate()` 後無 markdown 貢獻 |
| 3 | `deactivate()` 後無 error |

---

## 11. Verification (驗證)

```bash
cd /Users/shuk/projects/tmp/superset
npm run build       # tsc + package,確認無編譯錯誤
npm test            # 跑全部 vitest,確認既有 444 + 新 ~33 case 全綠
```

開 VSCode Extension Development Host (`code --extensionDevelopmentPath=.`),驗證:

1. **Explorer 出現 `Modified` view**(首次折疊),點 chevron 展開
2. **在 git repo 工作區**:tree 列出 modified 檔,folder node 顯示 `M N · A N` 摘要,file row 顯示對應 icon
3. **Untracked 預設顯示**:新建一個未 tracked 的 `.ts` 檔,1 秒內出現在 tree 末端
4. **點 ⊕ Untracked 按鈕**:toggle off 後,untracked 檔消失,M/A/D 仍在
5. **點 file row**:editor 開啟該檔
6. **右鍵 → Reveal in Explorer**:OS 檔案總管跳到該檔位置
7. **右鍵 → Copy Path**:剪貼簿有絕對路徑;Copy Relative Path 有 repo-relative 路徑
8. **切到非 git repo 工作區**:tree 顯示「Not a git repository」
9. **gitignore 排除**:`echo "node_modules/foo.js" > .gitignore && touch node_modules/foo.js` 後,foo.js 不出現在 panel
10. **FSW 即時反應**:在已 tracked 檔上 `echo "x" >> foo.ts`,1 秒內 panel 出現該檔

---

## Risks & Mitigations

| 風險 | 影響 | 緩解 |
|---|---|---|
| FSW `**/*` glob 在 `node_modules/` build 時大量觸發 | debounce window 內多次重置,git status 仍只跑一次 | 接受 — debounce 500ms 內任何觸發都歸零計時,git status 本身是 spawn,不受觸發次數影響 |
| `git rev-parse --show-toplevel` 對 submodule 行為 | 顯示 submodule root 而非 parent repo | 文件化行為;後續 task 加 explicit submodule 處理 |
| `git status` spawn 超時 | panel 卡在 "loading" | `Promise.race` 熔斷 10s(同 `topologyStore` 模式),timeout 後 state 變 error + 訊息 |
| 多 repo (multi-root) workspace | panel 只看 `workspaceFolders[0]` | YAGNI — 文件化,不處理 |
| Rename status 在 XY 同時有值時(例 `RM`)語意模糊 | 我們只看 R flag 忽略 M | 文件化 — 對使用者最直覺 |
| `gitStatusParser` 對非預期 XY 字符靜默跳過 | 漏顯示某些邊界狀態 | console.warn 留 audit trail |
| `toggleUntracked` 不重跑 git status 若 `state !== "ready"` | 早期 race 時 toggle 沒效果 | toggle 仍翻 flag,但只在 `ready` 觸發 rebuild;首次 ready 後 toggle 立即可見 |

---

## Out of scope (本次不做)

- Stage / Unstage / Discard 任何 git 寫入操作
- Diff preview / Open Changes 視窗
- 把 modified 標記同步到 Source Control panel
- 多 repo workspace 處理
- 自寫 gitignore parser(信任 git 行為)
- 把 panel 從 Explorer 移到 Activity Bar
- Modified count badge(例 `Explorer ▾ 12`);若需要後續加 `vscode.window.registerTreeDataProvider` + decoration
- 追蹤「哪些檔案是這個 session 內從 modified 變 committed」(短期歷史)
- 排除 `**/.git/**` 變更(理論上 git status 不會列;但 submodule 內 .git 變動可能出現)

---

## 設計備註 (Design notes)

### 為什麼把 folder node 做成合成虛擬節點(Approach A)而非走真實資料夾
- **Git 是 single source of truth** — 使用者對 panel 的預期是「git 看到什麼、panel 就顯示什麼」;合成 folder 反而比「真實但會有 modified-only child」的混合視圖誠實
- **`.gitignore` 零成本** — git 已處理 nested `.gitignore`、submodule 內 `.gitignore`、`.git/info/exclude`、global ignore;直接吃 `git status --porcelain` 的結果,不用自寫 parser
- **虛擬 folder 的 UX 細節** — folder node 點擊只展開/收合(無 open action);file row 才有 Open / Reveal / Copy 選單。語意清楚:「folder 是容器、file 是工作單位」

### 為什麼 `vscode.open` 的絕對路徑在 `treeProvider` 注入而非 `treeSpec`
- `treeSpec` 是純函式,測試不應依賴 repoRoot(那需要 mock filesystem)
- `treeProvider` 是 vscode-bound,本來就需要 repoRoot context
- 注入點單一,在測試 `treeSpec` 時不需考慮路徑形式

### 為什麼 `git status` 不帶 `--ignored`
- 我們要**排除** gitignored 檔,不是列出它們
- `git status --porcelain` 預設就過濾 gitignored(不論是 tracked + ignored 還是完全 untracked + ignored 都不會出現)
- 若帶 `--ignored`,輸出會多 `!!` 前綴行,parser 還得額外過濾,反而麻煩

### 為什麼 `toggleUntracked` 不重跑 git status
- `git status --porcelain` 的輸出包含 `??` 行;parser 已 parse 進 `state.files`
- `treeBuilder.build({ showUntracked: false })` 直接過濾掉 `?` 條目,無需重跑
- 節省一次 spawn;toggle 是高頻互動,UX 應 instant

### 為什麼 command 用 `revealFileInOS` 而非 `revealInExplorer`
- `revealInExplorer` 只對**當前** Explorer tree 已顯示的檔有效
- Modified files panel 是另一個 tree,跳過去會找不到目標
- `revealFileInOS` 呼叫 OS 檔案總管(finder / explorer.exe / nautilus),跨平台一致

### 為什麼走 `views.explorer` 而非 `views.superset`
- 使用者要求「sub panel in explorer」字面意義
- Explorer 是每日開啟的核心面板,modified files 在那邊**不需切換 Activity Bar 圖示**就能看到
- `views.superset` 是 6 個 panel 共用,加入會破壞既有「panel 集中管理」結構,且使用者要點 SuperSet 圖示才看得到