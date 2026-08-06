import { TodoStore } from "./todoStore";
import { scanWorkspaceTodoDirs } from "../todoEngine/workspaceScanner";
import type { WorkspaceTodoChange, WorkspaceTodoListener } from "./types";

/**
 * 當前 workspace 內多個 `README.todo` 的資料管理層
 * (WorkspaceTodoStore)。
 *
 * 負責:
 * - 只從「當前開啟的 VSCode workspace」根目錄往下遞迴掃描
 *   (深度由呼叫端傳入,見 `loadWorkspaceTodos`)。
 * - 只辨識大小寫完全相符的 `README.todo`;命中後仍繼續掃描子孫。
 * - 每個命中資料夾建立/維護一個 `TodoStore` 實例,
 *   TreeProvider 以相對路徑建立 sub-project group。
 *
 * 掃描邊界只有 workspace 一條,不得跨到 `~/projects`。
 */
export class WorkspaceTodoStore {
    private readonly listeners = new Set<WorkspaceTodoListener>();
    /**
     * Workspace sub-projects — key 為 sub-project 的絕對路徑,
     * 由 `loadWorkspaceTodos` 的遞迴掃描填入。
     */
    private readonly workspaceStores = new Map<string, TodoStore>();
    private readonly workspaceStoreListeners = new Map<string, () => void>();

    constructor() {}

    /**
     * 取得目前已載入的 workspace sub-project `TodoStore` map
     * (來自「當前 workspace 內部遞迴掃描」)。鍵值為 sub-project
     * 的絕對路徑。
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
     * 從「當前開啟的 VSCode workspace」根目錄遞迴掃描所有含
     * `README.todo` 的子目錄,為每個建/取 `TodoStore`,並 emit
     * `{ type: "loaded" }`。
     *
     * 設計語意:
     * - **workspace 根目錄 (depth 0) 也收** — 即使整個 workspace
     *   只有 root 自己有 `README.todo`,也要在 overview 頂部呈現
     *   「Current Workspace」section。否則使用者只看到 root
     *   `README.todo` 的 workspace,section 完全空白,失去意義。
     *   這個預設可由 `includeRoot = false` 覆寫,讓呼叫端只想看
     *   depth ≥ 1 的 sub-project(例:SuperSet TODO panel 的
     *   "just 1 layer right under current workspace" 語意)。
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

                // 註冊變更監聽器 — 任何 sub-project reload 都要讓
                // TreeProvider 重畫。
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
     * 重置所有 workspace sub-project 的快取（重新自硬碟載入內容）。
     */
    async reset(): Promise<void> {
        const promises = Array.from(this.workspaceStores.values()).map(
            (store) => store.reset(),
        );
        await Promise.all(promises);
        this.emit({ type: "loaded" });
    }

    /**
     * 註冊 workspace 資料更新監聽器。
     */
    onDidChange(listener: WorkspaceTodoListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(change: WorkspaceTodoChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }
}
