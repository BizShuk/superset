import { readdir, stat } from "fs/promises";
import * as path from "path";
import * as os from "os";
import { TodoStore } from "../todo/todoStore";
import type { ProjectsTodoChange, ProjectsTodoListener } from "./types";

/**
 * 跨專案待辦的資料管理層 (ProjectsTodoStore)。
 * 負責掃描 `~/projects` 與 `~/projects/tmp` 底下的專案，
 * 並為每個專案維護一個 `TodoStore` 執行個體，以重用既有的待辦解析與寫入邏輯。
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
     * 掃描全域專案目錄，尋找包含 `README.todo` 的資料夾並為其建立或更新 `TodoStore`。
     */
    async load(): Promise<void> {
        const home = os.homedir();
        const projectsDir = path.join(home, "projects");
        const detectedPaths: string[] = [];

        const scanDir = async (dirPath: string, checkSubDir: boolean) => {
            try {
                const entries = await readdir(dirPath);
                for (const entry of entries) {
                    if (entry.startsWith(".")) continue;
                    if (entry === "tmp" && checkSubDir) continue;

                    const fullPath = path.join(dirPath, entry);
                    try {
                        const s = await stat(fullPath);
                        if (s.isDirectory()) {
                            const todoFile = path.join(fullPath, "README.todo");
                            try {
                                const todoStat = await stat(todoFile);
                                if (todoStat.isFile()) {
                                    detectedPaths.push(fullPath);
                                }
                            } catch {
                                // README.todo 不存在
                            }
                        }
                    } catch {
                        // 忽略存取錯誤的目錄
                    }
                }
            } catch {
                // 忽略找不到的根目錄
            }
        };

        // 1. 掃描 ~/projects
        await scanDir(projectsDir, true);

        // 2. 掃描 ~/projects/tmp
        await scanDir(path.join(projectsDir, "tmp"), false);

        // 3. 更新 stores Map (新增新掃描到的，並移除已被刪除的)
        const currentPaths = new Set(detectedPaths);
        for (const existingPath of this.stores.keys()) {
            if (!currentPaths.has(existingPath)) {
                // 移除已失效的專案監聽器並從 Map 刪除
                const unsubscribe = this.storeListeners.get(existingPath);
                unsubscribe?.();
                this.storeListeners.delete(existingPath);
                this.stores.delete(existingPath);
            }
        }

        // 4. 載入每個專案的 TodoStore
        const loadPromises: Promise<void>[] = [];
        for (const projectPath of detectedPaths) {
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
