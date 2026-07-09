# TODO Panel 整合 plans/ 資料夾掃描

## Context (為何要做)

`~/projects/` 下 14 個專案各自有 `plans/` 資料夾存放 design doc (`2026-07-08-business-scope-evaluation.md` 等),目前沒有任何面板把它們列出來。`README.todo` 是「可勾選的工作清單」,`plans/` 是「進行中的設計文件」 — 兩者性質不同,但都屬於「專案內待關注的事項」。

使用者要的是:**點開 TODO 面板(local)或 Projects TODO 面板(global)時,plans 底下的每個 `.md` 檔以一列 read-only item 出現**,點擊開 markdown preview。這讓「現在有哪些 plan 在進行」一目了然,不需要再開檔案總管翻 `plans/`。

### 使用者已確認的設計決策
1. **只看 `plans/` 資料夾**:`docs/specs/` 不納入 (避免把已完成 architecture spec 誤判為 plan)
2. **全域只要有 `plans/` 就算專案**:沒有 `README.todo` 但有 `plans/` 的資料夾也會出現在 Projects TODO
3. **開啟 markdown 預覽透過右側 inline 按鈕**:`item.command` 留空,row click 不做事;靠 `package.json` 的 `view/item/context` `group: "inline"` menu entry 在每列右側顯示「Open」icon,點擊觸發 `superset.todoOpenPlan` (與 `todoOpenLink` 同模式)

### 不做
- 不解析 plans/*.md 內部的 `- [ ]` 為 sub-checkbox (plan 是 design doc 不是 todo list)
- 不實作「標記完成」功能 (完成的 plan 自然會被移到 `docs/specs/`,但這超出本次範圍)
- 不動 `treePreview` / `todoPreview` / `mDNS` / `topology` / `terminals` 模組

---

## Architecture (架構)

`plansSource` 為純函式模組 (對齊 `parser.ts` 模式),兩個 store 各加 plan 快取,兩個 tree provider 在既有 children 末端合成 `## Plans` section。沿用「純粹 extract 而非重寫」原則。

```tree
plans/*.md ──scanPlans──> PlanInfo[]
                          │
                          ├──> TodoStore.planItems (per-workspace)
                          │     └─> TodoTreeProvider 合成 ## Plans section
                          │         └─> superset.todo panel
                          │
                          └──> ProjectsTodoStore.planItems (per-project)
                                └─> ProjectsTodoTreeProvider 合成 ## Plans section
                                    └─> superset.projectsTodo panel
```

新 kind 統一表達為 `TodoItem.kind = "plan"` + `filePath: string`,沿用既有 `kind` discriminated union (與 `parser.ts:16` 風格一致),新分支只需在 `applyPriorityFilter` / `filterCompleted` / `getTreeItem` 各加一個 early-return。

---

## Critical files

- `src/todo/types.ts` — 加 `kind: "plan"` 到 union,加 `filePath?: string`
- `src/todo/plansSource.ts` **(新)** — 純函式 `scanPlans` + `PlanInfo`
- `src/todo/todoStore.ts` — 加 `planItems` 欄位、`getPlanItems()`、`load()` 內並行 scan
- `src/todo/todoTreeProvider.ts` — `buildPlanItem()`、`## Plans` section、`applyPriorityFilter` passthrough
- `src/todo/index.ts` — `plansWatcher` + `superset.todoOpenPlan` 命令
- `src/projectsTodo/projectsTodoStore.ts` — `planItems` map、掃 `plans/` 為專案識別、`getPlanItemsEntries()`
- `src/projectsTodo/projectsTodoTreeProvider.ts` — project node 末端附加 `## Plans`、plans-only 專案支援
- `src/projectsTodo/index.ts` — `plansWatcher` + `superset.projectsTodoOpenPlan` 命令
- `package.json` — 2 個新 command、context menu `when` clause、版本 0.8.3 → 0.8.4
- `CHANGELOG.md` — 0.8.4 條目
- `CLAUDE.md` — 「Plan Files Integration」段

新測試:
- `test/plansSource.test.ts` **(新,9 case)**
- `test/todoStore.test.ts` (+3 case)
- `test/todoTreeProvider.test.ts` (+6 case)
- `test/projectsTodoStore.test.ts` (+3 case)
- `test/projectsTodoTreeProvider.test.ts` (+4 case)

---

## Data Model

### 新 `PlanInfo` (在 `plansSource.ts`)

```ts
export interface PlanInfo {
    readonly basename: string;    // "2026-06-23-feature-foo"
    readonly title: string;        // 第一行 H1,fallback 到 basename
    readonly filePath: string;     // 絕對路徑
    readonly mtimeMs: number;
}
```

### `TodoItem` 新欄位 (`src/todo/types.ts`)

```ts
export interface TodoItem {
    // …既有欄位…
    readonly kind: "checkbox" | "list" | "section" | "plan";   // ← 加 "plan"
    readonly filePath?: string;                                 // ← 新增,kind="plan" 時必填
}
```

**為何選 `kind: "plan"` 而非復用 `kind: "list"`**:`list` 是 "free-form note 夾在 README.todo 行內",plan 是 "資料夾掃描來的整份 design doc"。前者有 priority tag 與 archive 行為,後者沒有 — 共用 kind 會讓 filter / 計數邏輯被迫加 `if (item.filePath)` 分流。明確加 `"plan"` 比到處加 hack 乾淨。

### 既存函式需要更新的 audit

每個 `kind ===` 分支點都會命中。逐一列出避免漏:

| 位置 | 行 | 動作 |
|---|---|---|
| `src/todo/todoTreeProvider.ts:111-115` | `getTreeItem` early branch | 加 `if (element.kind === "plan") return this.buildPlanItem(element);` |
| `src/todo/todoTreeProvider.ts:435-468` | `applyPriorityFilter` | 加 plan passthrough 在 regex match 之前 |
| `src/todo/todoTreeProvider.ts:487-530` | `filterCompleted` | 不需改 — plan 無 checked,且 section filter 在 line 510 已會清掉空 Plans section |
| `src/projectsTodo/projectsTodoTreeProvider.ts:74` | `getTreeItem` early branch | 加 plan 渲染分支在最前面 |
| `src/projectsTodo/projectsTodoTreeProvider.ts:217-258` | `getChildren` root | 處理 plans-only project (無 README.todo 但有 plans/) |
| `src/todo/index.ts:75-388` | 各 command handler | 加 `if (item?.kind === "plan") return;` (toggle/changePriority/archive/rollback/changeSection) |
| `src/projectsTodo/index.ts:108-401` | 各 command handler | 同上 |

### 合成 `## Plans` section 形狀

```ts
const PLANS_SECTION_LINE = -10;          // 任何負數,-100/-200 已用過
function makePlansSection(items: TodoItem[]): TodoItem {
    return {
        line: PLANS_SECTION_LINE,
        text: "Plans",
        kind: "section",
        level: undefined,                  // 合成,等同 "Default" 的處理
        checked: false,
        children: items,
        description: "設計文件 (Design documents)",
    };
}
```

`level: undefined` 讓 `computeSectionContextValue` (`projectsTodoTreeProvider.ts:206`) 走 `projectsTodoSection` 路徑 — 不會被誤判為 `projectsTodoSectionArchivable` 而冒出 archive context menu。

---

## 1. Pure scan module — `src/todo/plansSource.ts` (新)

對齊 `parser.ts` 風格:純函式、無 `vscode` import、`fs/promises` 用法與 `repository.ts:11` 一致。

```ts
import { readdir, readFile, stat } from "fs/promises";
import * as path from "path";
import type { TodoItem } from "./types";

export interface PlanInfo {
    readonly basename: string;
    readonly title: string;
    readonly filePath: string;
    readonly mtimeMs: number;
}

export const PLANS_DIR_NAME = "plans";
const H1_RE = /^#\s+(.+?)\s*$/;

/**
 * Scan <workspaceRoot>/plans/*.md, sorted by basename (date-prefixed
 * files sort first because digits < letters in localeCompare).
 * Missing or unreadable plans/ returns [].
 */
export async function scanPlans(workspaceRoot: string): Promise<PlanInfo[]> {
    const dir = path.join(workspaceRoot, PLANS_DIR_NAME);
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        return [];
    }
    const plans: PlanInfo[] = [];
    for (const basename of entries) {
        if (!basename.toLowerCase().endsWith(".md")) continue;
        const filePath = path.join(dir, basename);
        try {
            const s = await stat(filePath);
            if (!s.isFile()) continue;
            const title = await extractTitle(filePath, basename);
            plans.push({ basename, title, filePath, mtimeMs: s.mtimeMs });
        } catch {
            // 略過無法讀取的 entry
        }
    }
    plans.sort((a, b) => a.basename.localeCompare(b.basename));
    return plans;
}

async function extractTitle(filePath: string, basename: string): Promise<string> {
    try {
        const raw = await readFile(filePath, "utf-8");
        // 只看前 8 行找 H1,避開大型檔案
        for (const line of raw.split("\n", 8)) {
            const m = line.match(H1_RE);
            if (m) return m[1]!.trim();
        }
    } catch {}
    // Fallback:去掉 YYYY-MM-DD- 前綴、把 dash 換空白、title-case
    return basename
        .replace(/\.md$/i, "")
        .replace(/^\d{4}-\d{2}-\d{2}-/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * PlanInfo -> TodoItem。提供給兩個 store 共用。
 * 為避免每個呼叫端重複,此處 export 而非各 feature 內私有。
 */
export function planInfoToTodoItem(info: PlanInfo): TodoItem {
    return {
        line: PLANS_SECTION_LINE - 1,     // 與 section line 不衝突
        text: info.basename.replace(/\.md$/i, ""),     // 主標籤:檔名(去 .md)
        description: info.title,                        // hover/副標題:H1
        kind: "plan",
        checked: false,
        children: [],
        filePath: info.filePath,
        parentSection: "Plans",
    };
}
```

### 設計備註
- **無 prefix filter**:`plans/` 內既有 `2026-07-08-...` 也有 `2026-07-05-architecture-...` 與 `2026-07-05-dynamic-orbiting-pearl.md`,全部納入。`localeCompare` 讓數字前綴排前面,字母開頭排後面,時序直覺對。
- **`planInfoToTodoItem` 為何放這裡**:projectsTodo 也要做同樣轉換,放 `plansSource` 模組比每個 store 各寫一份乾淨。
- **`line: -10 - 1 = -11`**:合成 item 的 line 用負數;`-1` 是既有 "Default" section 用的,`-10` 給 Plans section,`-11` 給 plan item。

---

## 2. Local TodoStore — `src/todo/todoStore.ts`

```ts
import { scanPlans, planInfoToTodoItem, type PlanInfo } from "./plansSource";

export class TodoStore {
    private items: TodoItem[] = [];
    private planItems: PlanInfo[] = [];
    // …既有 repository、listeners…

    getPlanItems(): PlanInfo[] {
        return this.planItems;
    }

    async load(): Promise<void> {
        const [readResult, plans] = await Promise.all([
            this.repository.read(),
            scanPlans(this.workspaceRoot),       // 需要新增 workspaceRoot 欄位
        ]);
        this.items = readResult.items ?? [];
        this.planItems = plans;
        this.emit({ type: "loaded", items: this.items });
        // 既有 listener 只關心 items;PlanInfo 由 tree provider 直接讀 getPlanItems()
    }

    async reset(): Promise<void> {
        await this.load();
    }
}
```

**`workspaceRoot` 欄位**:目前 `TodoStore` 把 root 傳給 `TodoRepository`,但自己不留。需在 constructor 存 `this.workspaceRoot = workspaceRoot`。回歸測試只檢查公開介面,加欄位不影響 25 case。

**Event shape 決定**:不擴展 `TodoChange` union,沿用 `{ type: "loaded"; items }`。tree provider 在 `loaded` 時直接呼叫 `store.getPlanItems()` 拿 plan 快取。比新增 variant 簡單,且 `TodoChange` 沒暴露 plan 是因為 store 內部已同步過。

---

## 3. Local TreeProvider — `src/todo/todoTreeProvider.ts`

### 新 `buildPlanItem`

插入 `getTreeItem` 第一個 branch (line 111 之前):

```ts
if (element.kind === "plan") return this.buildPlanItem(element);
```

```ts
private buildPlanItem(element: TodoItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.text);     // basename (no .md)
    item.iconPath = new vscode.ThemeIcon("file-text");
    item.description = element.description;              // H1 title
    item.tooltip = `${element.description ?? element.text}\n${element.filePath}`;
    item.collapsibleState = vscode.TreeItemCollapsibleState.None;
    // 不設 item.command — row click 不做事。開啟靠 package.json menu 註冊的
    // inline icon 按鈕 (viewItem == todoPlan, group: "inline") 觸發
    // superset.todoOpenPlan,與既有 todoOpenLink 完全對稱。
    item.contextValue = "todoPlan";
    return item;
}
```

### Section view 末端合成 `## Plans`

修改 `getChildren` (line 387):

```ts
getChildren(element?: TodoItem): vscode.ProviderResult<TodoItem[]> {
    if (element) return sortSiblings(element.children || []);

    const raw = this.store.getItems();
    const completedFiltered = this.showCompleted ? raw : filterCompleted(raw);
    let filtered = applyPriorityFilter(completedFiltered, this.enabledPriorities);

    if (this.viewType === "priority") return this.buildPriorityGroups(filtered);
    if (this.viewType === "file") return this.buildFileGroups(filtered);

    // Section view: 末端加 Plans section(只在 store 有 plan 時)
    const plans = this.store.getPlanItems();
    if (plans.length > 0) {
        const plansSection = makePlansSection(plans.map(planInfoToTodoItem));
        filtered = [...filtered, plansSection];
    }
    return sortSiblings(filtered);
}
```

### File view:plan items 群組在 `plans/`

修改 `buildFileGroups` (line 319):傳入 `kind` 參數,在 `getFileGroup` (line 355) 早返回:

```ts
private getFileGroup(text: string, kind: TodoItem["kind"]): { label: string; description?: string } {
    if (kind === "plan") return { label: "plans", description: "plans/" };
    // …既有邏輯
}
```

`buildFileGroups` 的 `groups.sort` (line 347) 加一條規則讓 "plans" 排 "README.todo" 之後:

```ts
groups.sort((a, b) => {
    if (a.text === "README.todo") return -1;
    if (b.text === "README.todo") return 1;
    if (a.text === "plans") return -1;
    if (b.text === "plans") return 1;
    return a.text.localeCompare(b.text);
});
```

### `applyPriorityFilter` (line 435) 加 passthrough

在 `.map` callback 開頭、regex match 之前:

```ts
if (item.kind === "plan") {
    // Plans 沒有 priority tag,任何 priority filter 都保留。
    return item;
}
```

這讓 priority view 中 plan items 自然落入既有 "None" group (因為沒 priorityMatch),而非被濾掉。

### Section header `## Plans` 渲染

`buildSectionItem` (line 220) 開頭加:

```ts
if (element.text === "Plans") {
    item.iconPath = new vscode.ThemeIcon("file-code");
    item.description = `${element.children?.length ?? 0} plans`;
    item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    item.contextValue = "todoPlansSection";
    item.tooltip = "設計文件 (./plans/)";
    return item;
}
```

不加 `N ◐` badge — plan 不算 actionable work。

---

## 4. Local feature wiring — `src/todo/index.ts`

### Plans watcher (line 73 之後)

```ts
const plansWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(ctx.workspaceFolder, "plans/*.md")
);
const onPlansChanged = () => {
    store.load().then(() => refreshTodoFilterBadge());
};
plansWatcher.onDidChange(onPlansChanged);
plansWatcher.onDidCreate(onPlansChanged);
plansWatcher.onDidDelete(onPlansChanged);
// 推進 ctx.subscriptions 與 todoFileWatcher 同 disposable
```

`store.load()` 已並行掃 plans,watcher 只需 reload 一次。

### `superset.todoOpenPlan` 命令 (line 214 後)

```ts
const openPlanCmd = vscode.commands.registerCommand(
    "superset.todoOpenPlan",
    async (arg?: { filePath: string; title?: string }) => {
        if (!arg?.filePath) return;
        const uri = vscode.Uri.file(arg.filePath);
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            if (doc.languageId !== "markdown") {
                await vscode.languages.setTextDocumentLanguage(doc, "markdown");
            }
            await vscode.commands.executeCommand("markdown.showPreview", uri);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open plan: ${err}`);
        }
    }
);
```

### `refreshTodoFilterBadge` 型別放寬 (line 47)

```ts
// 既有
const all = provider.getChildren() as
    | { line: number; text: string; kind: "checkbox" | "list"; checked: boolean; children?: unknown[] }[]
    | undefined;
```

`provider.getChildren()` 現在回傳 `TodoItem[]`,section 行 kind 是 "section" 不是 "checkbox"|"list",TS 會報錯。放寬為:

```ts
const all = provider.getChildren() as
    | { line: number; text: string; kind: string; checked: boolean; children?: unknown[] }[]
    | undefined;
```

下游只讀 `.length`,型別損失無害。

### 既有命令加 plan guard

| 命令 | 行 | 加 |
|---|---|---|
| `todoToggle` | 75-82 | `if (item.kind === "plan") return;` |
| `todoChangePriority` | 96-120 | `if (item.kind === "plan") return;` |
| `todoArchive` / `todoRollback` | 257-271 | `if (item.kind === "plan") return;` |
| `todoChangeSection` | 289-333 | `if (item.kind === "plan") return;` |
| `todoDeleteSection` | 335-352 | `if (item.text === "Plans") return;` (已是 section,但合成 section 不應被刪) |
| `todoRename` / `todoDelete` | 354-388 | 既有 `if (item.kind !== "checkbox" && item.kind !== "list") return;` 已涵蓋 |

---

## 5. ProjectsTodoStore — `src/projectsTodo/projectsTodoStore.ts`

### 新 API

```ts
import { scanPlans, type PlanInfo } from "../todo/plansSource";

export class ProjectsTodoStore {
    private readonly stores = new Map<string, TodoStore>();
    private readonly planItems = new Map<string, PlanInfo[]>();
    private readonly listeners = new Set<ProjectsTodoListener>();
    private readonly storeListeners = new Map<string, () => void>();

    getStores(): Map<string, TodoStore> { return this.stores; }
    getStore(projectPath: string): TodoStore | undefined { return this.stores.get(projectPath); }
    getPlanItems(projectPath: string): PlanInfo[] {
        return this.planItems.get(projectPath) ?? [];
    }
    /** 給 treeProvider iterate 用 */
    getPlanItemsEntries(): IterableIterator<[string, PlanInfo[]]> {
        return this.planItems.entries();
    }
}
```

### 修改 `load()` (line 51)

兩件事:
1. **專案識別**改為「有 `README.todo` 或 `plans/` 任一」就算
2. **Plan cache** 與 TodoStore 並行載入

```ts
async load(): Promise<void> {
    const home = os.homedir();
    const projectsDir = path.join(home, "projects");
    const detectedTodoPaths = new Set<string>();
    const detectedPlansPaths = new Set<string>();

    const collect = async (dirPath: string, currentDepth: number): Promise<void> => {
        let entries: string[];
        try { entries = await readdir(dirPath); } catch { return; }
        for (const entry of entries) {
            if (entry.startsWith(".")) continue;
            const fullPath = path.join(dirPath, entry);
            let isDir = false;
            try { isDir = (await stat(fullPath)).isDirectory(); } catch { continue; }
            if (!isDir) continue;

            // 新:同時偵測 README.todo 與 plans/
            const todoFile = path.join(fullPath, "README.todo");
            const plansDir = path.join(fullPath, "plans");
            try { if ((await stat(todoFile)).isFile()) detectedTodoPaths.add(fullPath); } catch {}
            try { if ((await stat(plansDir)).isDirectory()) detectedPlansPaths.add(fullPath); } catch {}

            if (currentDepth < MAX_SCAN_DEPTH) await collect(fullPath, currentDepth + 1);
        }
    };
    await collect(projectsDir, 1);

    const detectedAll = new Set([...detectedTodoPaths, ...detectedPlansPaths]);

    // 清理被刪除的專案 (兩張 map + listener)
    for (const p of [...this.stores.keys()]) {
        if (!detectedAll.has(p)) {
            this.storeListeners.get(p)?.();
            this.storeListeners.delete(p);
            this.stores.delete(p);
            this.planItems.delete(p);
        }
    }
    for (const p of [...this.planItems.keys()]) {
        if (!detectedAll.has(p)) this.planItems.delete(p);
    }

    // 為有 README.todo 的專案建/重載 TodoStore
    const loadPromises: Promise<void>[] = [];
    for (const projectPath of detectedTodoPaths) {
        let store = this.stores.get(projectPath);
        if (!store) {
            store = new TodoStore(projectPath);
            this.stores.set(projectPath, store);
            const unsub = store.onDidChange(c => {
                if (c.type === "loaded") this.emit({ type: "loaded" });
            });
            this.storeListeners.set(projectPath, unsub);
        }
        loadPromises.push(store.load());
    }

    // 為所有專案掃 plans/ (含 plans-only)
    const planPromises: Promise<void>[] = [];
    for (const projectPath of detectedAll) {
        planPromises.push(
            scanPlans(projectPath).then(infos => {
                this.planItems.set(projectPath, infos);
            })
        );
    }
    await Promise.all([...loadPromises, ...planPromises]);
    this.emit({ type: "loaded" });
}
```

**Plans-only 專案的語意**:`getStores()` 不包含 plans-only 專案 (無 README.todo),但 `getPlanItems()` 包含。呼叫端需要先看 `getPlanItemsEntries()` 才知道完整專案清單 — 為此新增該方法。

**QuickPick 行為**:既有 `superset.projectsTodoNew` / `superset.projectsTodoOpen` 用 `store.getStores()` 組 picker (line 151,184)。plans-only 專案不會出現。若使用者透過 project row context menu 點 "New TODO",`item.projectPath` 會帶到 plans-only 專案,但 `getStore(p)` 回 `undefined` → 靜默失敗。修法見 §6。

---

## 6. ProjectsTodoTreeProvider — `src/projectsTodo/projectsTodoTreeProvider.ts`

### 修改 `getChildren` (line 217)

```ts
getChildren(element?: ProjectTodoItem): vscode.ProviderResult<ProjectTodoItem[]> {
    if (element) {
        if (element.kind === "section" && element.text === "Plans") {
            return sortSiblings(element.children || []);
        }
        return sortSiblings(element.children || []);
    }

    const projectItems: ProjectTodoItem[] = [];

    // (a) 有 README.todo 的專案 — 既有流程
    for (const [projectPath, store] of this.store.getStores()) {
        const projectName = path.basename(projectPath);
        const raw = store.getItems();
        const completedFiltered = this.showCompleted ? raw : filterCompleted(raw);
        const filtered = applyPriorityFilter(completedFiltered, this.enabledPriorities);
        const decoratedChildren = decorateItems(filtered, projectName, projectPath);

        // 末端加 Plans section(若有 plan)
        const plans = this.store.getPlanItems(projectPath);
        if (plans.length > 0) {
            const plansChildren = plans.map(p => ({
                ...planInfoToTodoItem(p),
                projectName,
                projectPath,
            }));
            decoratedChildren.push({
                ...makePlansSection(plansChildren),
                projectName,
                projectPath,
            });
        }

        projectItems.push({
            line: -1, text: projectName, kind: "section",
            checked: false, children: decoratedChildren,
            projectName, projectPath,
        });
    }

    // (b) Plans-only 專案 — 新增流程
    for (const [projectPath, plans] of this.store.getPlanItemsEntries()) {
        if (this.store.getStores().has(projectPath)) continue;  // 已處理
        if (plans.length === 0) continue;
        const projectName = path.basename(projectPath);
        const planChildren = plans.map(p => ({
            ...planInfoToTodoItem(p),
            projectName,
            projectPath,
        }));
        const plansSection: ProjectTodoItem = {
            ...makePlansSection(planChildren),
            projectName,
            projectPath,
        };
        projectItems.push({
            line: -1, text: projectName, kind: "section",
            checked: false, children: [plansSection],
            projectName, projectPath,
        });
    }

    projectItems.sort((a, b) => a.text.localeCompare(b.text));
    return projectItems;
}
```

### `getTreeItem` plan 分支 (line 74 之前)

```ts
if (element.kind === "plan") {
    const item = new vscode.TreeItem(element.text);
    item.iconPath = new vscode.ThemeIcon("file-text");
    item.description = element.description;
    item.tooltip = `${element.description ?? element.text}\n${element.filePath}`;
    // 同 local:不設 item.command,row click 不做事。靠 inline menu 按鈕開啟。
    item.contextValue = "projectsTodoPlan";
    return item;
}
```

### Section header `## Plans`

`buildSectionItem` (line 102) 開頭加類似 §3 的 early-return,contextValue 用 `projectsTodoPlansSection` 區分。

### `countPending` 不需改

Plans 沒 checked,既不算 pending 也不影響 section 計數。plans-only 專案 description = `"0 pending"` — 與 README-only 但全勾的專案同型,保持一致。

---

## 7. ProjectsTodo wiring — `src/projectsTodo/index.ts`

### Plans watcher (line 81 後)

```ts
const plansWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(projectsBaseDir, "**/plans/*.md")
);
const onPlansFileChanged = () => {
    // plans 變動可能影響 plans-only 專案的發現,跑全掃最安全
    store.load().then(() => refreshProjectsTodoFilterBadge());
};
plansWatcher.onDidChange(onPlansFileChanged);
plansWatcher.onDidCreate(onPlansFileChanged);
plansWatcher.onDidDelete(onPlansFileChanged);
```

### `superset.projectsTodoOpenPlan` 命令

與 `todoOpenPlan` 對稱 (line 213 後):

```ts
const openPlanCmd = vscode.commands.registerCommand(
    "superset.projectsTodoOpenPlan",
    async (arg?: { filePath: string; title?: string }) => {
        if (!arg?.filePath) return;
        const uri = vscode.Uri.file(arg.filePath);
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            if (doc.languageId !== "markdown") {
                await vscode.languages.setTextDocumentLanguage(doc, "markdown");
            }
            await vscode.commands.executeCommand("markdown.showPreview", uri);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open plan: ${err}`);
        }
    }
);
```

### QuickPick 涵蓋 plans-only 專案

`superset.projectsTodoNew` (line 146-177) 與 `superset.projectsTodoOpen` (line 179-213):

```ts
// 取代:
const activeProjects = Array.from(store.getStores().keys()).map(p => ({ label: path.basename(p), description: p }));

// 改為合併兩張 map:
const todoProjects = new Set(store.getStores().keys());
const allProjects = new Set([...todoProjects, ...Array.from(store.getPlanItemsEntries(), ([p, infos]) => infos.length > 0 ? p : null).filter(Boolean)]);
const activeProjects = Array.from(allProjects).map(p => ({
    label: path.basename(p),
    description: p,
}));
```

並在 `subStore` 為 undefined 時顯示 `vscode.window.showInformationMessage("此專案僅有 plans/,無 README.todo")` 並優雅返回。

---

## 8. `package.json` updates

### 兩個新 command (line 274 前)

```json
{
    "command": "superset.todoOpenPlan",
    "title": "Superset: Open Plan",
    "icon": "$(go-to-file)"
},
{
    "command": "superset.projectsTodoOpenPlan",
    "title": "Superset: Open Plan",
    "icon": "$(go-to-file)"
},
```

### Menu entries

```json
// view/item/context,local TODO
{ "command": "superset.todoOpenPlan", "when": "viewItem == todoPlan", "group": "inline" },
// view/item/context,projects TODO
{ "command": "superset.projectsTodoOpenPlan", "when": "viewItem == projectsTodoPlan", "group": "inline" },
```

`group: "inline"` 讓命令顯示為 row 右側的 icon 按鈕 (與 `todoOpenLink` 同模式),點擊 icon 觸發 `superset.todoOpenPlan` 開啟 markdown preview。Row 本身無 `item.command`,點 row 文字不做任何事。

### 既有 menu `when` 不需動

`superset.todoDeleteSection` 的 when 是 `viewItem == todoSection || todoSectionArchivable || todoSectionArchived` — `todoPlansSection` **不會** match,所以刪不掉合成 section (額外保險,搭配 §4 的 `if (item.text === "Plans") return`)。同理其他破壞性命令:plan row 的 contextValue 是 `todoPlan`/`projectsTodoPlan`,不會 match 任何既有 `viewItem == todoCheckbox/todoList/...`。

### 版本 bump

`"version": "0.8.3"` → `"0.8.4"` (patch)。

### CHANGELOG

新增 `## [0.8.4] - 2026-07-09` 條目,描述 plans/ 整合與 25 個新 case。

---

## 9. Test plan

### New: `test/plansSource.test.ts` (9 case)

用 `mkdtempSync` + `writeFileSync` 構造虛擬 plans/ 目錄 (對齊 `test/projectsTodoStore.test.ts:17-26` 風格):

| # | Case |
|---|---|
| 1 | Empty `plans/` dir → `[]` |
| 2 | Missing `plans/` → `[]` (不 throw) |
| 3 | 跳過非 `.md` 檔 (`foo.txt`, `bar.md.bak`) |
| 4 | 依 basename 排序 (`architecture-...` 在 `2026-...` 之後,因 `2` < `a`) |
| 5 | 多檔案 → 正確筆數與順序 |
| 6 | H1 抽取:`# Foo Bar` → `"Foo Bar"` |
| 7 | 無 H1 → fallback 到 humanised basename |
| 8 | 前 7 行空白、第 8 行才 H1 → 找到 |
| 9 | `planInfoToTodoItem` round-trip:`kind === "plan"`、`filePath` 設好、`checked === false`、`description === title` |

### `test/todoTreeProvider.test.ts` (+6)

1. Section view 有 plans 時,top-level 末端有 `## Plans` section
2. Section view 無 plans 時,不渲染 `## Plans`
3. `applyPriorityFilter` 啟用時 plan item 存活
4. `filterCompleted` 啟用時 plan item 存活
5. `buildPlanItem`: icon `file-text`、description = title、**無 `command` 屬性**、contextValue = `todoPlan`、無 `checkboxState`
6. `buildFileGroups`: plan item 落入 `"plans"` group,且排 `README.todo` 之後

### `test/todoStore.test.ts` (+3)

1. `load()` 後 `getPlanItems()` 回傳正確筆數
2. 缺 `plans/` 不 throw,`getPlanItems()` 回 `[]`
3. `load()` 後 listener 被叫、`getItems()` 與 `getPlanItems()` 都更新

### `test/projectsTodoStore.test.ts` (+3)

1. Plans-only 專案:`getStores()` 沒 key,`getPlanItems(p)` 有 1 個 entry
2. 兩者都有:兩個 map 都有
3. 刪除 `plans/` 後重掃,planItems 移除、stores 也移除 (若該專案無 README.todo)

### `test/projectsTodoTreeProvider.test.ts` (+4)

1. 有 README+plans 的專案,children 末端有 `## Plans` section
2. Plans-only 專案:在根層出現,children = `[plansSection]`
3. Plan item `getTreeItem`:contextValue = `projectsTodoPlan`、**無 `command` 屬性**
4. Plans-only 專案的 project row description = `"0 pending"`

### 既有測試

391 case 全綠。`todoStore.ts` 加 `workspaceRoot` 欄位、`TodoItem.kind` 多一個 union member — 既有測試不應受影響,因為對外介面沒變。

---

## 10. Verification (驗證)

```bash
cd /Users/shuk/projects/tmp/superset
npm run build       # tsc + package,確認無編譯錯誤
npm test            # 跑全部 vitest,確認既有 391 + 新 ~25 case 全綠
```

開 VSCode Extension Development Host (`code --extensionDevelopmentPath=.`),打開 `~/projects/tmp/superset` (有 `plans/` 的專案),驗證:

1. **Local TODO panel** 顯示 `## Plans` section,內含 20 個 plan item,row 右側有「Open」icon 按鈕,點 icon 開 markdown preview
2. **Row 本身點擊不做任何事** (與一般 non-link todo item 行為一致)
3. **Section / Priority / File view** 三種切換時 plan 都看得見
4. **Priority filter P0** 啟用後,plan item 還在 (不被濾掉)
5. **Hide completed** 開啟後,plan item 還在 (沒 checked 狀態)
6. **Projects TODO panel** 列出所有 14 個有 `plans/` 的專案,每個底下有 Plans section,row 右側有 Open icon
7. 新增一個 `plans/2026-07-09-test.md` → 兩面板即時更新 (watcher 觸發 reload)
8. 在 plans-only 專案 (沒 README.todo) 上點 New TODO → 顯示 "此專案僅有 plans/,無 README.todo"

---

## Risks & Mitigations

| 風險 | 影響 | 緩解 |
|---|---|---|
| `getChildren` 型別放寬 (line 47) | 失去精確型別 | 只讀 `.length`,下游無害 |
| Plans-only 專案的 `countPending` 不含 plan → description = "0 pending" | UX 略嫌空 | 與 README 全勾專案同型;後續 task 加變體 |
| Priority view plan item 落入 "None" group | 與未標 priority 的 todo 混在一起 | 文件化行為 (CHANGELOG) |
| QuickPick 未涵蓋 plans-only 專案 | §7 加合併邏輯修掉 | 已驗證語意 |
| 多達 20 個 plan 一次性掃描 | 啟動時間 | `scanPlans` 一次 readdir + 8-line head read,效能可接受 |

---

## Out of scope (本次不做)

- `docs/specs/` 自動偵測為已完成 plan
- 解析 plan 內部 `- [ ]` 為 sub-checkbox
- Plan item 的優先級 (P0/P1/P2)
- Plan item 的 archive / rollback
- 自動把 README.todo 中提及的 plan 連結同步進面板