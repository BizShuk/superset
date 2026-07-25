import * as path from "path";
import * as os from "os";
import { TodoStore } from "../todo/todoStore";
import { scanWorkspaceTodoDirs } from "../todoEngine/workspaceScanner";
import type { ProjectsTodoChange, ProjectsTodoListener } from "./types";

/**
 * Projects TODO 的全域掃描上限。`~/projects` 自身是 depth 0,
 * 其下子目錄依序是 depth 1–5。這是固定專案邊界,不與
 * Workspace TODO 的可設定 depth 共用。
 */
const PROJECTS_SCAN_MAX_DEPTH = 5;

/**
 * 跨專案待辦的資料管理層 (ProjectsTodoStore)。
 *
 * 負責:
 * - 只從 `~/projects` 單一根目錄往下遞迴 depth 1–5。
 * - 只辨識大小寫完全相符的 `README.todo`;命中後仍繼續掃描子孫。
 * - 每個命中資料夾建立/維護一個 `TodoStore` 實例,
 *   TreeProvider 以該資料夾名稱建立 project group。
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
     * 掃描範圍:`~/projects` 單一根目錄下的 depth 1–5。
     * 只收大小寫完全相符的 `README.todo`,且跳過 dot-prefix
     * 與 `TODO_SCAN_SKIP_DIRS` 子樹。`~/projects` root 自身不是 project row。
     */
    async load(): Promise<void> {
        const projectsRoot = path.join(os.homedir(), "projects");

        const detectedTodoPaths = new Set<string>(
            await scanWorkspaceTodoDirs(
                projectsRoot,
                PROJECTS_SCAN_MAX_DEPTH,
                false,
            ),
        );

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
     *   這個預設可由 `includeRoot = false` 覆寫,讓呼叫端只想看
     *   depth ≥ 1 的 sub-project(例:SuperSet TODO panel 的
     *   "just 1 layer right under current workspace" 語意)。
     * - 同路徑若同時被 `~/projects` 與 workspace scan 收為 project
     *   (例如 `~/projects/tmp/superset`),由渲染端在 `getChildren`
     *   抑制 `~/projects` 的 row,以 workspace section 為單一來源。
     * - 遞迴只走目錄,只看**正下方**的 `README.todo` 一個檔名
     *   (大小寫敏感);其他 todo 變體(`todo.md`、`TODO.md` ...)
     *   一律不接受 — 不開放設定開關。
     * - 三層 skip 規則任一命中即跳過**整個**子樹:dot-prefix、
     *   `TODO_SCAN_SKIP_DIRS` 黑名單、超過 `maxDepth`。
     *
     * `maxDepth < 1` 視為無效輸入,直接視為空結果(不 throw)。
     */
    async loadWorkspaceTodos(
        workspaceFolder: string,
        maxDepth: number,
        includeRoot: boolean = true,
    ): Promise<void> {
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

        const detectedTodoPaths = new Set<string>(
            await scanWorkspaceTodoDirs(workspaceFolder, maxDepth, includeRoot),
        );

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
