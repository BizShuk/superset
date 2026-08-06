// CLI Launcher feature 的註冊入口。
//
// 註冊「CLI」side panel (tree view)、路徑釘選命令,以及每列三顆 agent 按鈕
// (claude / codex / grok) 對應的啟動命令。每個步驟都寫進共用診斷日誌
// (`Superset: Show Diagnostic Logs`),按鈕沒反應時可以直接讀出卡在哪一步。

import * as os from "node:os";
import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import { getTreeViewRegistry } from "../plugin/treeViewRegistry";
import { registerViewVisibility } from "../plugin/viewVisibility";
import { AGENT_IDS, type AgentId } from "./command";
import {
    addEntry,
    CONFIG_SECTION,
    hidePath,
    loadAgentCommands,
    loadEntrySelectors,
    loadEntries,
    loadHiddenRules,
    loadRoots,
    removeEntry,
    unhideRule,
} from "./config";
import {
    collapseHome,
    formatHiddenRule,
    formatPathList,
    toCLIEntry,
    type CLIEntry,
} from "./entries";
import { buildCLILauncherCatalog } from "./catalog";
import { log, setCLILauncherLog } from "./log";
import { createNativeFindHandler } from "./nativeFind";
import { filterRepositoryFolders } from "./repositoryDiscovery";
import { scanRoots } from "./scan";
import { createSubfolder, validateSubfolderName } from "./subfolder";
import { initTerminalTracking, launchAll } from "./terminal";
import {
    CLILauncherTreeProvider,
    type CLILauncherTreeItem,
} from "./tree";

export const VIEW_ID = "superset.cliLauncher.paths";

/** CLI View 目前至少選取一個 path item 時為 true；只有 item focus 不算。 */
export const PATH_SELECTION_CONTEXT_KEY =
    "superset.cliLauncher.hasPathSelection";

/** 三顆 agent 按鈕對應的 command id,與 `package.json` 的宣告一致。 */
export const AGENT_COMMAND_IDS: Record<AgentId, string> = {
    claude: "superset.cliLauncherRunClaude",
    codex: "superset.cliLauncherRunCodex",
    grok: "superset.cliLauncherRunGrok",
};

export function register(ctx: FeatureContext): FeatureHandle {
    // feature 不自建 Output Channel;診斷全部進共用的 "Superset" channel。
    setCLILauncherLog(ctx.shared.log);
    const terminalTracker = initTerminalTracking(ctx.subscriptions);

    const provider = new CLILauncherTreeProvider(terminalTracker);
    const openNativeFind = createNativeFindHandler(VIEW_ID);
    // 多選:inline 按鈕仍作用在單列,但選取多列後的命令 (含 Cmd+N / Ctrl+1–4)
    // 會一次啟動全部。keybinding 觸發時沒有命令參數,只能靠 `view.selection`。
    const view = vscode.window.createTreeView<CLILauncherTreeItem>(VIEW_ID, {
        treeDataProvider: provider,
        showCollapseAll: true,
        canSelectMany: true,
    });
    void setPathSelectionContext(false);

    // 面板可見時才每 30 秒重掃一次;git 狀態沒有事件來源,只能定期重讀。
    const visibilitySub = registerViewVisibility(view, VIEW_ID, (visible) =>
        provider.setVisible(visible)
    );
    const treeViewEntry = getTreeViewRegistry()?.register(
        VIEW_ID,
        view as unknown as vscode.TreeView<unknown>,
        provider as unknown as vscode.TreeDataProvider<unknown>,
        ctx.shared.log
    );

    // 掃描結果沒有額外快取,`Reset Caches` 就等同重新掃描一次。
    ctx.resetHandlers.push(() => provider.refresh());

    const disposables: vscode.Disposable[] = [
        provider,
        view,
        visibilitySub,
        treeViewEntry ?? { dispose: () => undefined },
        view.onDidChangeSelection(({ selection }) => {
            void setPathSelectionContext(
                selection.some((item) => toCLIEntry(item) !== undefined)
            );
        }),
        // settings 是唯一的資料來源,外部改設定 (或我們自己寫入) 都靠這個事件刷新。
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(CONFIG_SECTION)) {
                provider.refresh();
            }
        }),
        vscode.commands.registerCommand("superset.cliLauncherRefresh", () => {
            provider.refresh();
        }),
        vscode.commands.registerCommand(
            "superset.cliLauncherFilter",
            openNativeFind
        ),
        vscode.commands.registerCommand(
            "superset.cliLauncherCopyAllPaths",
            async () => {
                await copyAllPathsToClipboard();
            }
        ),
        vscode.commands.registerCommand(
            "superset.cliLauncherAddPath",
            async () => {
                await addPathInteractively();
            }
        ),
        vscode.commands.registerCommand(
            "superset.cliLauncherCreateSubfolder",
            async (target: unknown, targets?: unknown[]) => {
                await runCommand(
                    "superset.cliLauncherCreateSubfolder",
                    { target, targets, view },
                    async (entries) => {
                        await createSubfolderInteractively(entries, provider);
                    }
                );
            }
        ),
        vscode.commands.registerCommand(
            "superset.cliLauncherRemovePath",
            async (target: unknown, targets?: unknown[]) => {
                await removePathInteractively({ target, targets, view });
            }
        ),
        vscode.commands.registerCommand(
            "superset.cliLauncherRestoreHidden",
            async () => {
                await restoreHiddenInteractively();
            }
        ),
        vscode.commands.registerCommand(
            "superset.cliLauncherOpen",
            async (target: unknown, targets?: unknown[]) => {
                await runCommand(
                    "superset.cliLauncherOpen",
                    { target, targets, view },
                    async (entries) => {
                        await launchAll(entries, "");
                    }
                );
            }
        ),
        vscode.commands.registerCommand(
            "superset.cliLauncherOpenNewWindow",
            async (target: unknown, targets?: unknown[]) => {
                await runCommand(
                    "superset.cliLauncherOpenNewWindow",
                    { target, targets, view },
                    async (entries) => {
                        for (const entry of entries) {
                            await vscode.commands.executeCommand(
                                "vscode.openFolder",
                                vscode.Uri.file(entry.path),
                                { forceNewWindow: true }
                            );
                        }
                    }
                );
            }
        ),
        ...AGENT_IDS.map((agent) =>
            vscode.commands.registerCommand(
                AGENT_COMMAND_IDS[agent],
                async (target: unknown, targets?: unknown[]) => {
                    await runCommand(
                        AGENT_COMMAND_IDS[agent],
                        { target, targets, view },
                        async (entries) => {
                            await launchAll(
                                entries,
                                loadAgentCommands()[agent],
                                agent
                            );
                        }
                    );
                }
            )
        ),
    ];

    ctx.subscriptions.push(...disposables);

    log(
        `registered: view=${VIEW_ID} commands=${[
            "superset.cliLauncherRefresh",
            "superset.cliLauncherFilter",
            "superset.cliLauncherCopyAllPaths",
            "superset.cliLauncherAddPath",
            "superset.cliLauncherCreateSubfolder",
            "superset.cliLauncherRemovePath",
            "superset.cliLauncherRestoreHidden",
            "superset.cliLauncherOpen",
            "superset.cliLauncherOpenNewWindow",
            ...AGENT_IDS.map((agent) => AGENT_COMMAND_IDS[agent]),
        ].join(", ")}`
    );

    return {
        dispose() {
            for (const disposable of disposables) {
                disposable.dispose();
            }
            void setPathSelectionContext(false);
            // module-level sink 不得存活到下一輪 activation。
            setCLILauncherLog(undefined);
        },
    };
}

function setPathSelectionContext(active: boolean): Thenable<unknown> {
    return vscode.commands.executeCommand(
        "setContext",
        PATH_SELECTION_CONTEXT_KEY,
        active
    );
}

interface CommandContext {
    /** 右鍵／inline 按鈕點到的那一列。 */
    target: unknown;
    /** 多選時 VS Code 額外帶入的整份選取。 */
    targets?: unknown[];
    /** keybinding 觸發時沒有任何參數,只能回頭問 tree view 目前選了什麼。 */
    view: vscode.TreeView<CLILauncherTreeItem>;
}

/**
 * 所有啟動類命令的共用外殼:解析選取 → 執行 → 記錄。任何例外都寫進日誌
 * 並跳出可見的錯誤訊息,不讓失敗停在「按了沒反應」。
 */
async function runCommand(
    commandID: string,
    context: CommandContext,
    run: (entries: CLIEntry[]) => void | Promise<void>
): Promise<void> {
    log(`${commandID}: invoked with ${describeContext(context)}`);
    try {
        const entries = await resolveEntries(context);
        if (entries.length === 0) {
            log(`${commandID}: no entry resolved, aborted`);
            return;
        }
        log(
            `${commandID}: ${entries.length} entr${
                entries.length === 1 ? "y" : "ies"
            } — ${entries.map((entry) => entry.path).join(", ")}`
        );
        await run(entries);
    } catch (error: unknown) {
        log(`${commandID}: failed — ${describeError(error)}`);
        await vscode.window.showErrorMessage(
            `CLI: ${commandID} 失敗 — ${describeError(error)}`
        );
    }
}

function describeContext({ target, targets, view }: CommandContext): string {
    const shape =
        target === undefined || target === null
            ? "no argument (keybinding/palette)"
            : typeof target !== "object"
              ? typeof target
              : `object keys=[${Object.keys(target as object).join(",")}]`;
    return `${shape}, targets=${targets?.length ?? 0}, selection=${
        view.selection.length
    }`;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * 解析命令要作用在哪些項目,優先序:
 *  1. 多選命令參數 (`targets`) —— 右鍵一份選取時 VS Code 會帶進來
 *  2. 單一命令參數 (`target`) —— inline 按鈕只作用在被點到的那一列
 *  3. tree view 目前的選取 —— Cmd+N / Ctrl+1–4 等 keybinding 沒有參數
 *  4. quick pick (`fallback`) —— 從 Command Palette 呼叫且面板沒有選取
 *
 * 啟動與移除共用同一份解析:選了幾列,動作就套用在那幾列,不會只處理游標下的
 * 那一個。差別只有第 4 步要問哪一份候選清單。
 */
async function resolveEntries(
    context: CommandContext,
    fallback: () => Promise<CLIEntry | undefined> = () => pickEntry("選擇路徑")
): Promise<CLIEntry[]> {
    const fromTargets = dedupe(context.targets ?? []);
    if (fromTargets.length > 1) {
        return fromTargets;
    }

    const fromTarget = dedupe([context.target]);
    if (fromTarget.length > 0) {
        return fromTarget;
    }

    const fromSelection = dedupe([...context.view.selection]);
    if (fromSelection.length > 0) {
        return fromSelection;
    }

    const picked = await fallback();
    return picked ? [picked] : [];
}

function dedupe(values: readonly unknown[]): CLIEntry[] {
    const seen = new Set<string>();
    const entries: CLIEntry[] = [];
    for (const value of values) {
        const entry = toCLIEntry(value);
        if (entry && !seen.has(entry.path)) {
            seen.add(entry.path);
            entries.push(entry);
        }
    }
    return entries;
}

/**
 * quick pick 的候選 = literal / Regex entries + 預設 Git repository tree，順序與面板一致。
 * 從 Command Palette 呼叫時才會走到這裡。
 */
async function listAllEntries(): Promise<CLIEntry[]> {
    const home = os.homedir();
    const catalog = buildCLILauncherCatalog(
        loadEntrySelectors(),
        await scanRoots(loadRoots(), home),
        loadHiddenRules(),
        home
    );
    const entries = catalog.entries.map(({ entry }) => entry);
    const defaultFolders = await filterRepositoryFolders(catalog.folders);

    for (const folder of defaultFolders) {
        for (const candidate of [folder.entry, ...folder.children]) {
            entries.push(candidate);
        }
    }

    return entries;
}

/**
 * `Copy All Paths`:把完整 catalog 的每一個項目 (釘選 + 掃描兩層,與 tree view
 * 的基礎順序一致) 的絕對路徑各佔一行寫進剪貼簿。不看選取狀態 —— 這是「複製全部」,
 * 不是「複製選取」。native Find Control 的 query 由 VS Code 擁有,因此這裡複製
 * catalog 的完整 path set。
 */
async function copyAllPathsToClipboard(): Promise<void> {
    const commandID = "superset.cliLauncherCopyAllPaths";
    log(`${commandID}: invoked`);
    try {
        const entries = await listAllEntries();
        if (entries.length === 0) {
            log(`${commandID}: no entries to copy`);
            await vscode.window.showInformationMessage(
                "CLI: 沒有可複製的路徑。"
            );
            return;
        }

        await vscode.env.clipboard.writeText(formatPathList(entries));
        log(`${commandID}: copied ${entries.length} paths`);
        await vscode.window.showInformationMessage(
            `CLI: 已複製 ${entries.length} 個路徑到剪貼簿。`
        );
    } catch (error: unknown) {
        log(`${commandID}: failed — ${describeError(error)}`);
        await vscode.window.showErrorMessage(
            `CLI: 複製路徑失敗 — ${describeError(error)}`
        );
    }
}

async function pickEntry(placeHolder: string): Promise<CLIEntry | undefined> {
    const entries = await listAllEntries();
    if (entries.length === 0) {
        const choice = await vscode.window.showInformationMessage(
            "CLI: 沒有可用的路徑。預設會掃描 ~/projects,或手動釘選一個路徑。",
            "釘選路徑"
        );
        if (choice) {
            await addPathInteractively();
        }
        return undefined;
    }

    const home = os.homedir();
    const picked = await vscode.window.showQuickPick(
        entries.map((entry) => ({
            label: entry.label,
            description: collapseHome(entry.path, home),
            entry,
        })),
        { placeHolder }
    );
    return picked?.entry;
}

async function addPathInteractively(): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: true,
        openLabel: "釘選到 CLI 面板",
    });
    if (!selection || selection.length === 0) {
        return;
    }

    const skipped: string[] = [];
    for (const uri of selection) {
        if (!(await addEntry(uri.fsPath))) {
            skipped.push(uri.fsPath);
        }
    }

    if (skipped.length > 0) {
        await vscode.window.showInformationMessage(
            `CLI: 已釘選過,略過 ${skipped.length} 個路徑。`
        );
    }
}

/**
 * 在每個 resolved path 下建立同名 direct child。Input Box 只問一次；多選與
 * Command Palette 的 path resolution 仍由共用 `resolveEntries` 負責。
 */
async function createSubfolderInteractively(
    entries: readonly CLIEntry[],
    provider: CLILauncherTreeProvider
): Promise<void> {
    const rawName = await vscode.window.showInputBox({
        title:
            entries.length === 1
                ? `CLI: 在「${entries[0].label}」建立子資料夾`
                : `CLI: 在 ${entries.length} 個路徑建立子資料夾`,
        prompt: "輸入 direct subfolder 名稱。",
        placeHolder: "例如 my-project",
        validateInput: validateSubfolderName,
    });
    if (rawName === undefined) {
        return;
    }

    let created = 0;
    try {
        for (const entry of entries) {
            const target = await createSubfolder(entry.path, rawName);
            created += 1;
            log(`superset.cliLauncherCreateSubfolder: created ${target}`);
        }
    } finally {
        if (created > 0) {
            provider.refresh();
        }
    }

    await vscode.window.showInformationMessage(
        entries.length === 1
            ? `CLI: 已建立「${rawName.trim()}」。`
            : `CLI: 已在 ${entries.length} 個路徑建立「${rawName.trim()}」。`
    );
}

/**
 * `Remove from Panel`:把選取的列從面板拿掉。兩層掃描一定會撈到不想要的資料夾,
 * 所以掃描出來的列也要能移除,而不是只有釘選的列。
 *
 * 兩種來源的移除方式不同,但對使用者是同一個動作:
 *  - 釘選的路徑 → 從 `superset.cliLauncher.entries` 移除。
 *  - 掃描出來的資料夾 → 寫進 `superset.cliLauncher.hidden`,連同其子路徑隱藏。
 *    磁碟上的資料夾不會被動到,`Restore Hidden Paths` 可以還原。
 *
 * 多選時一次處理整份選取:清理面板本來就是一口氣挑掉好幾列的動作,逐列確認
 * 等於把它變成 N 次對話。確認只跳`一次`,兩種來源可以混在同一次選取裡。
 */
async function removePathInteractively(
    context: CommandContext
): Promise<void> {
    const commandID = "superset.cliLauncherRemovePath";
    const entries = await resolveEntries(context, pickRemovableEntry);
    if (entries.length === 0) {
        return;
    }

    const pinnedPaths = new Set(loadEntries().map((item) => item.path));
    const allPinned = entries.every((entry) => pinnedPaths.has(entry.path));
    const action = allPinned ? "取消釘選" : "從面板移除";
    const confirmed = await vscode.window.showWarningMessage(
        confirmRemoveMessage(entries, allPinned),
        { modal: true },
        action
    );
    if (confirmed !== action) {
        return;
    }

    let changed = 0;
    for (const entry of entries) {
        const pinned = pinnedPaths.has(entry.path);
        const removed = pinned
            ? await removeEntry(entry.path)
            : await hidePath(entry.path);
        changed += removed ? 1 : 0;
        log(
            `${commandID}: ${pinned ? "unpinned" : "hidden"} ${entry.path} — ${
                removed ? "ok" : "no change"
            }`
        );
    }

    if (changed < entries.length) {
        await vscode.window.showInformationMessage(
            entries.length === 1
                ? "CLI: 此路徑已不在面板清單內。"
                : `CLI: ${entries.length - changed} 個路徑已不在面板清單內。`
        );
    }
}

/** 單選沿用原本點名的句子;多選只報數量,列出十幾個 label 反而看不完。 */
function confirmRemoveMessage(
    entries: readonly CLIEntry[],
    allPinned: boolean
): string {
    if (entries.length === 1) {
        return allPinned
            ? `取消釘選「${entries[0].label}」?`
            : `把「${entries[0].label}」從 CLI 面板移除?資料夾本身不會被刪除。`;
    }
    return allPinned
        ? `取消釘選 ${entries.length} 個路徑?`
        : `把 ${entries.length} 個路徑從 CLI 面板移除?資料夾本身不會被刪除。`;
}

/** Command Palette 呼叫時沒有命令參數:候選 = 釘選 + 目前掃描到的資料夾。 */
async function pickRemovableEntry(): Promise<CLIEntry | undefined> {
    const entries = await listAllEntries();
    if (entries.length === 0) {
        await vscode.window.showInformationMessage("CLI: 沒有可移除的路徑。");
        return undefined;
    }

    const home = os.homedir();
    const picked = await vscode.window.showQuickPick(
        entries.map((entry) => ({
            label: entry.label,
            description: collapseHome(entry.path, home),
            entry,
        })),
        { placeHolder: "選擇要從 CLI 面板移除的路徑" }
    );
    return picked?.entry;
}

/**
 * `Restore Hidden Paths`:把移除掉的掃描路徑放回面板。沒有這個出口,移除就等於
 * 只能手動編輯 settings 才救得回來。
 */
async function restoreHiddenInteractively(): Promise<void> {
    const hidden = loadHiddenRules();
    if (hidden.length === 0) {
        await vscode.window.showInformationMessage(
            "CLI: 沒有被移除的路徑。"
        );
        return;
    }

    const home = os.homedir();
    const picked = await vscode.window.showQuickPick(
        hidden.map((rule) => ({
            label: formatHiddenRule(rule, home),
            rule,
        })),
        { placeHolder: "選擇要放回面板的路徑", canPickMany: true }
    );
    if (!picked || picked.length === 0) {
        return;
    }

    for (const item of picked) {
        await unhideRule(item.rule);
    }
    log(`superset.cliLauncherRestoreHidden: restored ${picked.length} paths`);
}
