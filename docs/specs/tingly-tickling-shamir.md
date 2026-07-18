# Overview — Recursive Project Todo Panel From Current Workspace

## Context

`src/projectsTodo/` 目前的「跨專案一覽」只掃 `~/projects/` 與 `~/projects/tmp/` **第一層**的 `README.todo`(見 `projectsTodoStore.ts:30-39` 的設計註解),深層子目錄一律視為內部子目錄、不收為獨立 project。

當開發者打開的是 `~/projects/tmp/superset/` 這類本身已存在 `README.todo` 的 workspace 時,overview 只能看到 workspace 自己讀到的那一份,看不到 workspace **內部**其他含有 `README.todo` 的子目錄(例如 `superset/test/`、`superset/src/` 之類若有 todo)。本次新增一個獨立 top-level section,從**當前開啟的 VSCode workspace** 為根,沿目錄樹遞迴掃描(預設深度上限 3,可由設定調整),把工作區內所有 `README.todo` 集中呈現為「## Current Workspace」section,跟原本的「projects 一覽」並列、互不干擾。

設計前提:
- 「當前 workspace」採 `FeatureContext.workspaceFolder`(即 `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath`),與其他 feature 一致 — 多 root workspace 只看第一個。
- 遞迴必須避開 `node_modules` / `.git` / `.vscode` / `out` / `dist` 等常見會爆炸的目錄;深度上限由設定控制,預設 3。
- 既有的 `~/projects` 一覽**完全不動**,僅新增;既有 21 個 `projectsTodoTreeProvider` 黑箱 case + 9 個 `projectsTodoStore` 黑箱 case 必須不破。

---

## Implementation

### 1. `src/projectsTodo/projectsTodoStore.ts` — 新增 workspace scan

在既有 `stores: Map<string, TodoStore>` 旁新增**獨立的** `workspaceStores: Map<string, TodoStore>`(workspace sub-projects 與 `~/projects` projects 兩條命名空間不混用),公開兩個新方法:

- `async loadWorkspaceTodos(workspaceFolder: string, maxDepth: number): Promise<void>`
  - 以 `workspaceFolder` 為根呼叫私有 helper `collectWorkspaceTodoFiles(root, maxDepth, out)`
  - 對找到的每個路徑建/取 `TodoStore`(跟既有 `load()` 同模式),再平行 `store.load()`
  - 清掉已被刪除的 workspace sub-project(刪 `storeListeners` + `stores.delete`)
  - 完成後 emit `{ type: "loaded" }`
- `getWorkspaceStores(): Map<string, TodoStore>`(唯讀 accessor)

`collectWorkspaceTodoFiles` 是**純函式**(對齊 `parser.ts` 風格,無 `vscode` import,易測):

- 用 `readdir({ withFileTypes: true })` + 同步 `stat` 失敗 catch-all 跳過
- **只比對 `README.todo` 一個檔名**(大小寫敏感、`path.basename === "README.todo"`)。其他 todo 變體(`todo.md`、`TODO.md`、`TODOs.md`、`tasks.md` …)一律不接受 — 不要擴展成 glob pattern、不要加設定開關。
- 跳過規則(三層,任一命中就跳,跳過**整個**子樹):
  1. dot-prefix 目錄(`.git` / `.vscode` / `.idea` / `.next` …)
  2. 固定黑名單 `WORKSPACE_SCAN_SKIP_DIRS = new Set(["node_modules", "out", "dist", "build", "coverage"])`
  3. 超過 `maxDepth`(以 `path.relative(root, dir).split(path.sep).length - 1` 計算;預設 3,設定上限 1–10)
- 命中 `README.todo` 檔案的目錄 → 把該 dir 加入 `out: Set<string>`,該目錄**不會**再向下遞迴(因為 sub-project 自己就是一個 TodoStore 邊界,不要再把它的內部孫層又收成獨立 project)

> 注意 — 只看目錄**正下方**的 `README.todo`,不深入搜尋子孫檔案。例:`<root>/a/b/README.todo` 在 depth=2 才命中,`<root>/a/b/c/README.todo` 不會因為 `a/b/c` 下面有 `b/README.todo` 而被誤收(實際上結構上也不可能,但明寫以免日後改成 symlink follow 時誤會)。

**重用既有**:`TodoStore`(直接傳入 `projectPath` 構造)、`TodoRepository`、`scanPlans` — 全都已經知道怎麼處理單一 `README.todo`。

### 2. `src/projectsTodo/projectsTodoTreeProvider.ts` — render workspace section

`getChildren()` 在 `projectItems.sort(...)` **之前**,先 push 一個 synthetic top-level row:

```ts
const workspaceStores = this.store.getWorkspaceStores();
if (workspaceStores.size > 0) {
    projectItems.push(makeWorkspaceSection(workspaceStores, this.showCompleted, this.enabledPriorities));
}
```

新私有 helper `makeWorkspaceSection(...)`:

- 建一個 `kind: "section"`,`text: "Current Workspace"`,`projectPath: ""` (沿用 top-level「Plans」row 的空字串約定,讓 `openProject` 命令端早返)
- 走與既有 per-project 相同的 `filterCompleted` + `applyPriorityFilter` + 附加 `## Plans` sub-section 邏輯
- `projectName` 用 `path.relative(workspaceRoot, projectPath) || path.basename(projectPath)`,所以「`src/todo`」而不是只有「todo」 — 讓使用者一眼看出 nested 結構
- 子節點 decorator 用 workspace root 取代 projectPath(也讓 `openProject` 命令走 `vscode.openFolder` 時打開子資料夾)

`getTreeItem()` 加一個 case:`text === "Current Workspace"` 時:
- `iconPath: ThemeIcon("root-folder")`(區隔於一般 project 的 `folder`)
- `description: "${N} sub-projects"`
- `collapsibleState: Collapsed`(預設收合,跟既有 project row 語意一致)
- `contextValue: "projectsTodoWorkspaceSection"`(新值,僅讓 `view/title` 可在後續加 refresh 鈕;本次不啟用任何 context menu)

### 3. `src/projectsTodo/index.ts` — 接線

在既有 `store.load()` 之後追加:

```ts
const workspaceFolder = ctx.workspaceFolder;
const config = vscode.workspace.getConfiguration("superset.projectsTodo");
const maxDepth = config.get<number>("maxDepth", 3);

const loadWorkspace = () =>
    store.loadWorkspaceTodos(workspaceFolder, maxDepth).then(() => refreshProjectsTodoFilterBadge());

loadWorkspace();
```

並新增一個 workspace-relative 的 `FileSystemWatcher`:

```ts
const workspaceTodoWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, "**/README.todo"),
);
const onWorkspaceTodoChanged = () => loadWorkspace();
workspaceTodoWatcher.onDidChange(onWorkspaceTodoChanged);
workspaceTodoWatcher.onDidCreate(onWorkspaceTodoChanged);
workspaceTodoWatcher.onDidDelete(onWorkspaceTodoChanged);
```

**重要 — 與既有 watcher 的互斥**:`ctx.workspaceFolder` 若落在 `~/projects` 底下(例如 `~/projects/tmp/superset`),workspace watcher 與既有的 `projectsBaseDir = ~/projects` watcher 會重疊;後者已在 `onTodoFileChanged` 對未知 path 走 `store.load()` 觸發 project scan,前者只觸發 workspace scan — **兩條路徑各自走各自的 store map**,互不污染,但同一個 `README.todo` 變動會跑兩次掃描。在 store 層加一個 de-dup hint:若某 path 同時在 `stores` 與 `workspaceStores` 裡,以 workspace 為準(project 那邊略過 — 同一份 `README.todo` 不該出現在兩個 section)。

設定變更偵聽:

```ts
const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("superset.projectsTodo.maxDepth")) {
        const newDepth = vscode.workspace
            .getConfiguration("superset.projectsTodo")
            .get<number>("maxDepth", 3);
        maxDepth = newDepth; // closure-local mutable
        void loadWorkspace();
    }
});
```

`ctx.subscriptions.push` 補上 `workspaceTodoWatcher` + `configSub`;`dispose()` 也要釋放。

### 4. `package.json` — 新增 configuration

在 `contributes` 區塊加:

```json
"configuration": {
    "title": "Superset Projects TODO",
    "properties": {
        "superset.projectsTodo.maxDepth": {
            "type": "number",
            "default": 3,
            "minimum": 1,
            "maximum": 10,
            "description": "Recursion depth for the 'Current Workspace' section in Projects TODO overview. Scans README.todo files from the open workspace root up to this many subdirectory levels."
        }
    }
}
```

### 5. `CLAUDE.md` — 補一段設計說明

新增 `### Recursive Current Workspace Section`(對齊既有「Per-Project Plans Sub-Section」段):

- 三層 skip 規則(同 store 註解)
- workspace 與 `~/projects` 是兩個獨立 store map,不互相污染
- sub-project row 用相對路徑命名,icon 用 `root-folder` 區隔
- 設定 `superset.projectsTodo.maxDepth` 預設 3,變更會即時重掃

### 6. 版本

依 `package.json` 規範,patch bump:`0.13.4` → `0.13.5`。

---

## Files to modify

| 檔案 | 變動摘要 |
| ---- | -------- |
| `src/projectsTodo/projectsTodoStore.ts` | +`workspaceStores` Map、+`loadWorkspaceTodos()`、+`getWorkspaceStores()`、+`collectWorkspaceTodoFiles()` 純函式、+`WORKSPACE_SCAN_SKIP_DIRS` 常數 |
| `src/projectsTodo/projectsTodoTreeProvider.ts` | +`makeWorkspaceSection()` helper、+`getChildren()` 中 push top-level row、+`getTreeItem()` 加 workspace section case |
| `src/projectsTodo/index.ts` | +workspace scan call、+`FileSystemWatcher`(workspace 相對 pattern)、+`onDidChangeConfiguration` 偵聽、subscription + dispose |
| `package.json` | +`contributes.configuration` 區塊,version `0.13.4` → `0.13.5` |
| `CLAUDE.md` | +「Recursive Current Workspace Section」設計說明段落 |

## Files unchanged (但要驗證不被破)

- `src/todo/todoStore.ts`、`src/todo/plansSource.ts`(純 reuse,不動)
- `src/todoEngine/`(adapter 模式沿用既有,不動)
- 其他 feature module(完全不影響)

---

## Reused utilities

| 既有 | 檔案 | 用法 |
| ---- | ---- | ---- |
| `TodoStore` constructor | `src/todo/todoStore.ts:56` | 直接 `new TodoStore(projectPath)`,每個 workspace sub-project 一個 instance |
| `TodoRepository` | `src/todo/repository.ts` | `TodoStore` 內部已 inject,不需直接呼叫 |
| `scanPlans`、`planInfoToTodoItem`、`makePlansSection` | `src/todo/plansSource.ts` | workspace sub-project 也要附加 per-project `## Plans` sub-section,跟既有 project row 走同一條 helper |
| `filterCompleted`、`applyPriorityFilter`、`countPending`、`sortSiblings`、`dispatchContextValue`、`cleanTags`、`extractPriorityTag`、`stripMarkdownLink`、`priorityIconPath` | `src/todoEngine/` | sub-project 渲染完全沿用,行為一致 |
| `isArchivedSubsection`、`isArchivedTask` | `src/todo/parser.ts` | badge / context value 計算 |
| `setContextValue`-pattern `viewItem == projectsTodoPlan` 等 | `package.json` menus | 新 `viewItem == projectsTodoWorkspaceSection` 不啟用 menu(本次不開),先預留 |

---

## Verification

### 單元測試(必跑)

`npm test` 必須全綠,**新 case 全 pass + 既有 case 全不破**。預計新增:

`test/projectsTodoStore.test.ts` 加 8 個 case:
- 找到 depth 1 / 2 / 3 各自的 `README.todo`
- `maxDepth=3` 不收 depth 4
- 跳過 `node_modules`、`out`、`dist`、dot-prefix 目錄
- sub-project 刪除後重掃,map 正確縮減
- 空 workspace folder(無 `README.todo`)回傳空 map
- **只認 `README.todo`**:目錄裡放 `todo.md` / `TODO.md` / `tasks.md` / `TODOs.md` 都不收,正名大小寫敏感(`readme.todo` 也不收)
- **命中即停**:子目錄命中 `README.todo` 後,其內部的孫層子目錄不再被掃描(避免一個 sub-project 內部又冒出 sub-sub-project 造成遞迴)

`test/projectsTodoTreeProvider.test.ts` 加 4 個 case:
- workspace section 出現於 top-level,`text === "Current Workspace"`
- section description 為 `N sub-projects`
- sub-project row 的 `projectName` 是相對路徑(例如 `src/todo` 不是 `todo`)
- 無 workspace sub-project 時 section 不出現(不渲染空殼)

### 手動驗證(必做)

1. 在 `superset/` workspace 開 extension development host:
   - 在 `superset/test/` 建 `README.todo`,內容 `- [ ] nested test todo`
   - 開 Overall view → 應看到 `## Current Workspace`(展開)底下有 `test` row,row 裡有該 todo
2. 改 `superset.test/node_modules/README.todo` 與 `superset/.git/README.todo` → 兩個都不該出現
3. depth=3 外的目錄(例如 `~/projects/tmp/superset/src/todo/.deep/nested/README.todo`)不出現
4. 改設定 `superset.projectsTodo.maxDepth = 5`,reload → 原本沒出現的深層項目出現
5. **只認 `README.todo`**:在 `superset/test/` 建 `todo.md`(`# TODO\n- [ ] via todo.md`)→ 不該出現;建 `TODO.md` / `tasks.md` / `TODOs.md` 都不該出現(只有 `README.todo` 進)
6. **命名大小寫敏感**:`readme.todo`(全小寫)在子目錄 → 不該出現
7. **命中即停**:在 `superset/test/README.todo` 命中後,在 `superset/test/deeper/README.todo` 再放一份 → 第二份不該出現(因為 `test` 自己已是 TodoStore 邊界)
8. `npm run build` 必須 exit 0
9. `npx @vscode/vsce package` 必須 exit 0 且 `.vsix` 通過 `scripts/verify-vsix.sh`

### 迴歸檢查

- 既有 21 個 `projectsTodoTreeProvider` 黑箱 case + 9 個 `projectsTodoStore` 黑箱 case 全綠
- 整個 extension 的 621 個 test 全綠
- 在既有 `~/projects` 一覽行為不變(無 workspace sub-project 時,section 完全不出現;有重疊時,workspace 優先)
