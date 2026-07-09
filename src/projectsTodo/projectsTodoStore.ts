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
 * Plan scan 的 workspace 路徑 (絕對路徑)。Overview 只對這兩處做
 * 「one-layer」掃描,每個路徑底下**第一層**子目錄的 `plans/*.md` 才會
 * 被列入 — 反映「overview 是 live workspace 一覽」,深層 plans (例如
 * `~/projects/foo/sub/plans/`) 屬於 `foo` 自身,不由 overview 額外展開。
 *
 * 注意第二條是 `~/projects/tmp`,不是 `~/tmp` — 對應根 `CLAUDE.md` 的
 * workspace 分層:`~/projects` 是所有專案的家目錄,`tmp/` 是其中一個
 * 進行中子分類。playground/archive 不在掃描範圍,因為它們的「第一層
 * 子目錄」(實驗/歸檔樣本)不會再進一步晉升為 live 專案。
 */
function getPlanRoots(home: string): string[] {
    return [path.join(home, "projects"), path.join(home, "projects", "tmp")];
}

/**
 * 跨專案待辦的資料管理層 (ProjectsTodoStore)。
 *
 * 負責兩件事:
 * - 從 `~/projects` 往下掃描 (最深 3 層),找出含 `README.todo` 的資料夾,
 *   為每個建立/維護 `TodoStore` 實例 (重用既有 todo 解析/寫入邏輯)。
 * - 從 `~/projects` 與 `~/projects/tmp` 各自的**第一層**子目錄收集
 *   `<project>/plans/*.md`,合併成一份 workspace 層級的 plan 清單,
 *   給 TreeProvider 在 overview 末端開一個 top-level「Plans」row。
 */
export class ProjectsTodoStore {
    private readonly stores = new Map<string, TodoStore>();
    private workspacePlans: WorkspacePlan[] = [];
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
     * 取得 workspace 層級的 plan 清單 (來自 `~/projects/<p>/plans/` 與
     * `~/projects/tmp/<p>/plans/` 的第一層掃描)。每筆帶有 `projectPath`
     * 與 `projectName` 供 TreeProvider 顯示 / 開檔。
     */
    getWorkspacePlans(): readonly WorkspacePlan[] {
        return this.workspacePlans;
    }

    /**
     * 掃描全域專案目錄,尋找包含 `README.todo` 的資料夾,並平行收集
     * workspace 層級的 plans。
     *
     * README 掃描:從 `~/projects` 出發向下遞迴,最深 3 層
     * (即 `~/projects/<a>/<b>/<c>/...`)。命中隱藏目錄 (`.` 開頭) 一律跳過。
     *
     * Plans 掃描:只走 `~/projects` 與 `~/projects/tmp` 各自的第一層子目錄
     * (即所有「直接子資料夾」),讀取 `<child>/plans/*.md`。
     */
    async load(): Promise<void> {
        const home = os.homedir();
        const projectsDir = path.join(home, "projects");
        const detectedTodoPaths = new Set<string>();

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

                // 還能往下走就遞迴 (currentDepth=1 表示已走 ~/projects/<x>,還能再下兩層)
                if (currentDepth < MAX_SCAN_DEPTH) {
                    await collect(fullPath, currentDepth + 1);
                }
            }
        };

        await collect(projectsDir, 1);

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

        // 收集 workspace plans:只看 ~/projects 與 ~/projects/tmp 兩個 root
        // 的第一層子目錄(已存在才能算 live project),遞迴不再深入。
        const planScanPromises: Promise<WorkspacePlan[]>[] = [];
        for (const root of getPlanRoots(home)) {
            planScanPromises.push(this.scanRootPlans(root));
        }
        const planBatches = await Promise.all([...loadPromises, ...planScanPromises]);
        // planScanPromises 的回傳值接在 loadPromises 之後
        const planResults = planBatches.slice(loadPromises.length) as WorkspacePlan[][];
        this.workspacePlans = planResults
            .flat()
            .sort((a, b) => a.projectName.localeCompare(b.projectName)
                || a.info.basename.localeCompare(b.info.basename));

        this.emit({ type: "loaded" });
    }

    /**
     * 掃描 `<root>` 下每個第一層子目錄的 `plans/*.md`。
     * 不存在的 root 安靜跳過 (回傳 `[]`);子目錄缺 `plans/` 也跳過。
     * 結果附帶 `projectName` / `projectPath` 供 TreeProvider 顯示。
     */
    private async scanRootPlans(root: string): Promise<WorkspacePlan[]> {
        let entries: string[];
        try {
            entries = await readdir(root);
        } catch {
            return [];
        }
        const childDirs = entries.filter((e) => !e.startsWith("."));
        const results = await Promise.all(
            childDirs.map(async (child): Promise<WorkspacePlan[]> => {
                const projectPath = path.join(root, child);
                let isDir = false;
                try {
                    isDir = (await stat(projectPath)).isDirectory();
                } catch {
                    return [];
                }
                if (!isDir) return [];
                const infos = await scanPlans(projectPath);
                return infos.map((info) => ({ info, projectName: child, projectPath }));
            })
        );
        return results.flat();
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

/**
 * 一筆 workspace plan 條目:除了 `PlanInfo` 自身,還標記所屬的 project
 * (來自 `~/projects/<projectName>/plans/` 或 `~/projects/tmp/<projectName>/plans/`)
 * 給 TreeProvider 在 top-level「Plans」row 之下顯示時使用。
 */
export interface WorkspacePlan {
    readonly info: PlanInfo;
    readonly projectName: string;
    readonly projectPath: string;
}