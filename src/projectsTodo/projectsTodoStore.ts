import { readdir, stat } from "fs/promises";
import type { Dirent } from "fs";
import * as path from "path";
import * as os from "os";
import { TodoStore } from "../todo/todoStore";
import type { ProjectsTodoChange, ProjectsTodoListener } from "./types";

/**
 * 目錄名稱黑名單 — workspace scan 在遞迴時遇到這些目錄整個跳過。
 * 預期會膨脹或明顯不是 sub-project 的目錄(例如依賴快取、建置輸出、
 * 測試覆蓋率)。使用者定義的 `node_modules/`、`out/`、`dist/` 等
 * 都會被自動排除,不需要再手動加設定。
 */
const WORKSPACE_SCAN_SKIP_DIRS: ReadonlySet<string> = new Set([
    "node_modules",
    "out",
    "dist",
    "build",
    "coverage",
]);

/**
 * Project scan 的 workspace 根路徑 (絕對路徑)。Overview 只把
 * `~/projects` 與 `~/projects/tmp` 兩個根目錄底下的**第一層**
 * 子目錄視為 live project — 反映「overview 是 live workspace 一覽」,
 * 深層資料夾 (例如 `~/projects/data/pkg/stock/`) 屬於它所屬的專案
 * 內部子目錄,不由 overview 當作獨立 project 收進來。
 *
 * 為何兩條都列:對應根 `CLAUDE.md` 的 workspace 分層 — `~/projects` 是
 * 所有專案的家目錄,`tmp/` 是其中一個進行中子分類。`playground/` 與
 * `archive/` 不在掃描範圍,因為它們的「第一層子目錄」(實驗/歸檔樣本)
 * 不會再進一步晉升為 live 專案。
 *
 * 此函式同時被 `README.todo` 與 `plans/*.md` 兩種掃描共用,確保兩邊
 * 的「project 邊界」一致。
 */
function getPlanRoots(home: string): string[] {
    return [path.join(home, "projects"), path.join(home, "projects", "tmp")];
}

/**
 * 跨專案待辦的資料管理層 (ProjectsTodoStore)。
 *
 * 負責兩件事:
 * - 從 `~/projects` 與 `~/projects/tmp` 兩個根目錄各自的**第一層**子目錄
 *   找出含 `README.todo` 的資料夾,為每個建立/維護 `TodoStore` 實例
 *   (重用既有 todo 解析/寫入邏輯)。不向下遞迴 — 深層資料夾屬於它所屬
 *   的專案內部子目錄,不由 overview 收為獨立 project。
 * - 從 `~/projects` 與 `~/projects/tmp` 各自的**第一層**子目錄收集
 *   `<project>/plans/*.md`,合併成一份 workspace 層級的 plan 清單,
 *   給 TreeProvider 在 overview 末端開一個 top-level「Plans」row。
 *
 * README.todo 與 plans 的 project 邊界共用 `getPlanRoots(home)`,確保
 * 兩邊語意一致:「第一層子目錄 = live project」。
 */
export class ProjectsTodoStore {
    private readonly stores = new Map<string, TodoStore>();
    private readonly listeners = new Set<ProjectsTodoListener>();
    private readonly storeListeners = new Map<string, () => void>();
    /**
     * Workspace sub-projects — 跟 `stores` 是兩條獨立命名空間,
     * 互不污染。前者來自 `~/projects` 跨專案一覽,後者來自
     * 「當前 workspace 內部遞迴掃描」(見 `loadWorkspaceTodos`)。
     * 兩個 map 都以絕對路徑為 key,但同一個路徑若出現在兩邊,
     * 渲染端只會挑一個出來(workspace 優先),避免重複顯示。
     */
    private readonly workspaceStores = new Map<string, TodoStore>();
    private readonly workspaceStoreListeners = new Map<string, () => void>();

    constructor() {}

    /**
     * 取得目前所有已載入的專案 `TodoStore`。
     * 鍵值為專案的絕對路徑 (projectPath)。
     */
    getStores(): Map<string, TodoStore> {
        return this.stores;
    }

    /**
     * 依據路徑取得特定的 `TodoStore`。
     */
    getStore(projectPath: string): TodoStore | undefined {
        return this.stores.get(projectPath);
    }

    /**
     * 取得目前已載入的 workspace sub-project `TodoStore` map
     * (來自「當前 workspace 內部遞迴掃描」)。鍵值為 sub-project
     * 的絕對路徑。與 `getStores()` 的 `~/projects` projects 是兩條
     * 獨立的命名空間 — 渲染端依上下文決定顯示哪一邊。
     */
    getWorkspaceStores(): Map<string, TodoStore> {
        return this.workspaceStores;
    }

    /**
     * 依據路徑取得特定的 workspace sub-project `TodoStore`。
     */
    getWorkspaceStore(projectPath: string): TodoStore | undefined {
        return this.workspaceStores.get(projectPath);
    }

    /**
     * 掃描全域專案目錄,尋找包含 `README.todo` 的資料夾。
     *
     * 掃描範圍:只走 `~/projects` 與 `~/projects/tmp` 兩個根目錄
     * 各自的第一層子目錄 (即所有「直接子資料夾」)。命中隱藏目錄
     * (`.` 開頭) 一律跳過。不向下遞迴 — 深層資料夾屬於它所屬的專案
     * 內部子目錄,不由 overview 收為獨立 project。
     */
    async load(): Promise<void> {
        const home = os.homedir();
        const detectedTodoPaths = new Set<string>();

        // README.todo:只看兩個根目錄各自的第一層子目錄;深層
        // (例如 `~/projects/data/pkg/stock/README.todo`)不收。
        for (const root of getPlanRoots(home)) {
            await this.collectFirstLayerTodoFiles(root, detectedTodoPaths);
        }

        // 清理被刪除的專案 (移除 store + listener)
        for (const existingPath of [...this.stores.keys()]) {
            if (!detectedTodoPaths.has(existingPath)) {
                const unsubscribe = this.storeListeners.get(existingPath);
                unsubscribe?.();
                this.storeListeners.delete(existingPath);
                this.stores.delete(existingPath);
            }
        }

        // 為有 README.todo 的專案載入 TodoStore
        const loadPromises: Promise<void>[] = [];
        for (const projectPath of detectedTodoPaths) {
            let store = this.stores.get(projectPath);
            if (!store) {
                store = new TodoStore(projectPath);
                this.stores.set(projectPath, store);

                // 註冊變更監聽器，當子 store 資料更新時，通知外層 Provider 更新
                const unsubscribe = store.onDidChange((change) => {
                    if (change.type === "loaded") {
                        this.emit({ type: "loaded" });
                    }
                });
                this.storeListeners.set(projectPath, unsubscribe);
            }
            loadPromises.push(store.load());
        }

        await Promise.all(loadPromises);
        this.emit({ type: "loaded" });
    }

    /**
     * 從「當前開啟的 VSCode workspace」根目錄遞迴掃描所有含
     * `README.todo` 的子目錄,為每個建/取 `TodoStore`,並 emit
     * `{ type: "loaded" }`。結果放到獨立的 `workspaceStores` map,
     * 不會與 `load()` 的 `~/projects` projects 互相污染。
     *
     * 設計語意:
     * - **workspace 根目錄 (depth 0) 也收** — 即使整個 workspace
     *   只有 root 自己有 `README.todo`,也要在 overview 頂部呈現
     *   「Current Workspace」section。否則使用者只看到 root
     *   `README.todo` 的 workspace,section 完全空白,失去意義。
     * - 同路徑若同時被 `~/projects` 與 workspace scan 收為 project
     *   (例如 `~/projects/tmp/superset`),由渲染端在 `getChildren`
     *   抑制 `~/projects` 的 row,以 workspace section 為單一來源。
     * - 遞迴只走目錄,只看**正下方**的 `README.todo` 一個檔名
     *   (大小寫敏感);其他 todo 變體(`todo.md`、`TODO.md` ...)
     *   一律不接受 — 不開放設定開關。
     * - 三層 skip 規則任一命中即跳過**整個**子樹:dot-prefix、
     *   `WORKSPACE_SCAN_SKIP_DIRS` 黑名單、超過 `maxDepth`。
     *
     * `maxDepth < 1` 視為無效輸入,直接視為空結果(不 throw)。
     */
    async loadWorkspaceTodos(workspaceFolder: string, maxDepth: number): Promise<void> {
        if (!workspaceFolder || maxDepth < 1) {
            // 清空舊的 workspaceStores(若 maxDepth 被改成 0)
            for (const existingPath of [...this.workspaceStores.keys()]) {
                const unsubscribe = this.workspaceStoreListeners.get(existingPath);
                unsubscribe?.();
                this.workspaceStoreListeners.delete(existingPath);
                this.workspaceStores.delete(existingPath);
            }
            // 一律 emit,讓 listeners 知道 workspace section 現在是空的 —
            // 即使先前已有 stores,清空也算一次資料變動。
            this.emit({ type: "loaded" });
            return;
        }

        const detectedTodoPaths = new Set<string>();
        await this.collectWorkspaceTodoFiles(workspaceFolder, maxDepth, detectedTodoPaths);

        // 清理被刪除的 workspace sub-project (移除 store + listener)
        for (const existingPath of [...this.workspaceStores.keys()]) {
            if (!detectedTodoPaths.has(existingPath)) {
                const unsubscribe = this.workspaceStoreListeners.get(existingPath);
                unsubscribe?.();
                this.workspaceStoreListeners.delete(existingPath);
                this.workspaceStores.delete(existingPath);
            }
        }

        // 為有 README.todo 的 sub-project 載入 TodoStore
        const loadPromises: Promise<void>[] = [];
        for (const projectPath of detectedTodoPaths) {
            let store = this.workspaceStores.get(projectPath);
            if (!store) {
                store = new TodoStore(projectPath);
                this.workspaceStores.set(projectPath, store);

                // 註冊變更監聽器 — 與 `stores` 走同一條 emit 路徑,
                // 任何 sub-project reload 都要讓 TreeProvider 重畫。
                const unsubscribe = store.onDidChange((change) => {
                    if (change.type === "loaded") {
                        this.emit({ type: "loaded" });
                    }
                });
                this.workspaceStoreListeners.set(projectPath, unsubscribe);
            }
            loadPromises.push(store.load());
        }

        await Promise.all(loadPromises);
        this.emit({ type: "loaded" });
    }

    /**
     * 掃描 `<root>` 的第一層子目錄,將含 `README.todo` 的路徑加入 `out`。
     * 不存在的 root 安靜跳過;隱藏目錄 (`.` 開頭) 跳過。
     */
    private async collectFirstLayerTodoFiles(root: string, out: Set<string>): Promise<void> {
        let entries: string[];
        try {
            entries = await readdir(root);
        } catch {
            return; // root 不存在或無法讀取 (例如 ~/projects/tmp 缺席)
        }
        for (const entry of entries) {
            if (entry.startsWith(".")) continue;

            const fullPath = path.join(root, entry);
            let isDir = false;
            try {
                isDir = (await stat(fullPath)).isDirectory();
            } catch {
                continue; // 忽略存取錯誤的 entry
            }
            if (!isDir) continue;

            const todoFile = path.join(fullPath, "README.todo");
            try {
                const todoStat = await stat(todoFile);
                if (todoStat.isFile()) {
                    out.add(fullPath);
                }
            } catch {
                // README.todo 不存在,正常 — 該子目錄不是 live project
            }
        }
    }

    /**
     * 從 `<root>` 出發往下遞迴,把所有含 `README.todo` 的子目錄
     * 收進 `out`。設計細節見 `loadWorkspaceTodos` docblock。
     *
     * 純函式(無 `vscode` import),易於單元測試。
     */
    private async collectWorkspaceTodoFiles(
        root: string,
        maxDepth: number,
        out: Set<string>,
    ): Promise<void> {
        // 從 root 自身 (depth 0) 開始走 — workspace 根目錄也視為合法
        // sub-project。若它有 `README.todo`,也要收進來(不依賴
        // local TODO 面板來顯示,因為 overview 是不同視角)。
        await this.walkWorkspaceTodoFiles(root, root, 0, maxDepth, out);
    }

    /**
     * Recursion worker — 從 `current` (depth `depth`) 開始:
     * 1. 檢查正下方是否有 `README.todo`;若有 → 加入 `out`
     *    (繼續往下走;巢狀 sub-project 也照收)
     * 2. 若 `depth >= maxDepth` → return(不遞迴)
     * 3. 否則對每個非跳過的子目錄遞迴呼叫自己(`depth + 1`)
     *
     * 注意 — 命中 `README.todo` **不會**停止遞迴。否則 `a` 一旦命中,
     * `a/b` 與 `a/b/c` 的 sub-project 會被遮蔽,monorepo 場景的
     * 巢狀 sub-project 完全看不見。
     */
    private async walkWorkspaceTodoFiles(
        root: string,
        current: string,
        depth: number,
        maxDepth: number,
        out: Set<string>,
    ): Promise<void> {
        // 1. 檢查 README.todo (大小寫敏感,只看完全相同的檔名)。
        // 用 `readdir` 列舉再精確比對,而不是 `stat("README.todo")`
        // — 後者在 macOS APFS (case-insensitive) 預設會把
        // `readme.todo` 對到 `README.todo` 而誤判。
        let childEntries: string[];
        try {
            childEntries = await readdir(current);
        } catch {
            return; // 目錄讀不到,跳過
        }
        if (childEntries.includes("README.todo")) {
            try {
                const todoStat = await stat(path.join(current, "README.todo"));
                if (todoStat.isFile()) {
                    out.add(current);
                    // 不 return — 繼續遞迴進子孫層,讓巢狀 sub-project 也收
                }
            } catch {
                // 同名 entry 但 stat 失敗(權限/symlink loop),跳過
            }
        }

        // 2. 已達深度上限
        if (depth >= maxDepth) return;

        // 3. 遞迴進入子目錄
        let dirEntries: Dirent[];
        try {
            dirEntries = await readdir(current, { withFileTypes: true });
        } catch {
            return; // 子目錄讀不到,跳過該分支
        }

        for (const entry of dirEntries) {
            if (!entry.isDirectory()) continue;
            if (entry.name.startsWith(".")) continue;
            if (WORKSPACE_SCAN_SKIP_DIRS.has(entry.name)) continue;

            await this.walkWorkspaceTodoFiles(
                root,
                path.join(current, entry.name),
                depth + 1,
                maxDepth,
                out,
            );
        }
    }

    /**
     * 重置所有專案的快取（重新自硬碟載入內容）。
     * 同時重置 workspace sub-projects,確保兩條命名空間同步刷新。
     */
    async reset(): Promise<void> {
        const promises = [
            ...Array.from(this.stores.values()).map((store) => store.reset()),
            ...Array.from(this.workspaceStores.values()).map((store) => store.reset()),
        ];
        await Promise.all(promises);
        this.emit({ type: "loaded" });
    }

    /**
     * 註冊跨專案資料更新監聽器。
     */
    onDidChange(listener: ProjectsTodoListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(change: ProjectsTodoChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }
}