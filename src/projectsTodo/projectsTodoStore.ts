import { readdir, stat } from "fs/promises";
import * as path from "path";
import * as os from "os";
import { TodoStore } from "../todo/todoStore";
import type { ProjectsTodoChange, ProjectsTodoListener } from "./types";

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
     * 重置所有專案的快取（重新自硬碟載入內容）。
     */
    async reset(): Promise<void> {
        const promises = Array.from(this.stores.values()).map((store) => store.reset());
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