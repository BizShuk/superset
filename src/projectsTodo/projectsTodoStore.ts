import { readdir, stat } from "fs/promises";
import * as path from "path";
import * as os from "os";
import { TodoStore } from "../todo/todoStore";
import { scanPlans, type PlanInfo } from "../todo/plansSource";
import type { ProjectsTodoChange, ProjectsTodoListener } from "./types";

/**
 * 從 `~/projects` 出發,最遠掃到的子孫層級。
 *
 * 也就是:
 * - depth 1: `~/projects/<project>/README.todo`
 * - depth 2: `~/projects/<a>/<project>/README.todo` (含 `~/projects/tmp/<project>/README.todo`)
 * - depth 3: `~/projects/<a>/<b>/<project>/README.todo`
 * - depth 4 以上:不掃
 */
const MAX_SCAN_DEPTH = 3;

/**
 * 跨專案待辦的資料管理層 (ProjectsTodoStore)。
 * 負責從 `~/projects` 往下掃描 (最深 3 層),找出含 `README.todo` 或 `plans/`
 * 的資料夾:前者建立/維護 `TodoStore` 實例 (重用既有 todo 解析/寫入邏輯),
 * 後者為每個專案 (含 plans-only) 維護一份 plan 快取,供 TreeProvider 在每個
 * project node 末端合成 `## Plans` section 使用。
 */
export class ProjectsTodoStore {
    private readonly stores = new Map<string, TodoStore>();
    private readonly planItems = new Map<string, PlanInfo[]>();
    private readonly listeners = new Set<ProjectsTodoListener>();
    private readonly storeListeners = new Map<string, () => void>();

    constructor() {}

    /**
     * 取得目前所有已載入的專案 `TodoStore`。
     * 鍵值為專案的絕對路徑 (projectPath)。
     *
     * 注意:只有含 `README.todo` 的專案會出現在此 map;plans-only 專案
     * 仍會被識別與渲染,但需要透過 `getPlanItems(p)` 取得其內容,
     * 或透過 `getPlanItemsEntries()` 迭代所有有 plans 的專案。
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
     * 取得指定專案的 plans 掃描結果,沒有時回 `[]`。
     */
    getPlanItems(projectPath: string): PlanInfo[] {
        return this.planItems.get(projectPath) ?? [];
    }

    /**
     * 迭代所有 (projectPath, plans) 對,給 TreeProvider 在處理 plans-only
     * 專案時使用 — 這些專案不會出現在 `getStores()` 中。
     */
    getPlanItemsEntries(): IterableIterator<[string, PlanInfo[]]> {
        return this.planItems.entries();
    }

    /**
     * 掃描全域專案目錄,尋找包含 `README.todo` 或 `plans/` 的資料夾。
     *
     * 從 `~/projects` 出發向下遞迴,最深 3 層 (即 `~/projects/<a>/<b>/<c>/...`)。
     * 命中隱藏目錄 (`.` 開頭) 一律跳過。
     */
    async load(): Promise<void> {
        const home = os.homedir();
        const projectsDir = path.join(home, "projects");
        const detectedTodoPaths = new Set<string>();
        const detectedPlansPaths = new Set<string>();

        // 從 ~/projects 出發往下,最深 3 層。root 本身 (depth 0) 不視為 project
        // (即使 ~/projects/README.todo 存在也不列入),掃的是它的直接子資料夾到第 3 層子孫。
        const collect = async (dirPath: string, currentDepth: number): Promise<void> => {
            let entries: string[];
            try {
                entries = await readdir(dirPath);
            } catch {
                return; // 目錄不存在或無法讀取
            }

            for (const entry of entries) {
                if (entry.startsWith(".")) continue;

                const fullPath = path.join(dirPath, entry);
                let isDir = false;
                try {
                    const s = await stat(fullPath);
                    isDir = s.isDirectory();
                } catch {
                    continue; // 忽略存取錯誤的 entry
                }
                if (!isDir) continue;

                // 偵測 README.todo (作為 TodoStore 建立的條件)
                const todoFile = path.join(fullPath, "README.todo");
                try {
                    const todoStat = await stat(todoFile);
                    if (todoStat.isFile()) {
                        detectedTodoPaths.add(fullPath);
                    }
                } catch {
                    // README.todo 不存在,正常
                }

                // 偵測 plans/ (作為專案識別的條件之一,plans-only 專案由此納入)
                const plansDir = path.join(fullPath, "plans");
                try {
                    const plansStat = await stat(plansDir);
                    if (plansStat.isDirectory()) {
                        detectedPlansPaths.add(fullPath);
                    }
                } catch {
                    // plans/ 不存在,正常
                }

                // 還能往下走就遞迴 (currentDepth=1 表示已走 ~/projects/<x>,還能再下兩層)
                if (currentDepth < MAX_SCAN_DEPTH) {
                    await collect(fullPath, currentDepth + 1);
                }
            }
        };

        await collect(projectsDir, 1);

        // 3. 完整專案集合 (有 README.todo 或 plans/)
        const detectedAll = new Set([...detectedTodoPaths, ...detectedPlansPaths]);

        // 清理被刪除的專案 (兩張 map + listener)
        for (const existingPath of [...this.stores.keys()]) {
            if (!detectedAll.has(existingPath)) {
                // 移除已失效的專案監聽器並從 Map 刪除
                const unsubscribe = this.storeListeners.get(existingPath);
                unsubscribe?.();
                this.storeListeners.delete(existingPath);
                this.stores.delete(existingPath);
                this.planItems.delete(existingPath);
            }
        }
        for (const existingPath of [...this.planItems.keys()]) {
            if (!detectedAll.has(existingPath)) {
                this.planItems.delete(existingPath);
            }
        }

        // 4. 為有 README.todo 的專案載入 TodoStore
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

        // 5. 為所有專案 (含 plans-only) 掃描 plans/
        const planPromises: Promise<void>[] = [];
        for (const projectPath of detectedAll) {
            planPromises.push(
                scanPlans(projectPath).then((infos) => {
                    this.planItems.set(projectPath, infos);
                })
            );
        }

        await Promise.all([...loadPromises, ...planPromises]);
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