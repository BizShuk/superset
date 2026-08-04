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
    loadAgentCommands,
    loadEntries,
    loadRoots,
    removeEntry,
} from "./config";
import {
    collapseHome,
    formatPathList,
    toCLIEntry,
    type CLIEntry,
} from "./entries";
import { filterCLIEntries } from "./filter";
import { log, setCLILauncherLog } from "./log";
import { scanRoots } from "./scan";
import { initTerminalTracking, launchAll } from "./terminal";
import { CLIEntryTreeItem, CLILauncherTreeProvider } from "./tree";

export const VIEW_ID = "superset.cliLauncher.paths";

/** 有作用中的過濾字串時才為 true;`Clear Filter` 按鈕靠它顯示／隱藏。 */
export const FILTER_CONTEXT_KEY = "superset.cliLauncher.filtered";

/** 三顆 agent 按鈕對應的 command id,與 `package.json` 的宣告一致。 */
export const AGENT_COMMAND_IDS: Record<AgentId, string> = {
    claude: "superset.cliLauncherRunClaude",
    codex: "superset.cliLauncherRunCodex",
    grok: "superset.cliLauncherRunGrok",
};

export function register(ctx: FeatureContext): FeatureHandle {
    // feature 不自建 Output Channel;診斷全部進共用的 "Superset" channel。
    setCLILauncherLog(ctx.shared.log);
    initTerminalTracking(ctx.subscriptions);

    const provider = new CLILauncherTreeProvider();
    // 多選:inline 按鈕仍作用在單列,但選取多列後的命令 (含 ctrl+1/2/3)
    // 會一次啟動全部。keybinding 觸發時沒有命令參數,只能靠 `view.selection`。
    const view = vscode.window.createTreeView<CLIEntryTreeItem>(VIEW_ID, {
        treeDataProvider: provider,
        showCollapseAll: true,
        canSelectMany: true,
    });

    const visibilitySub = registerViewVisibility(view, VIEW_ID);
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
            async () => {
                await filterInteractively(provider, view);
            }
        ),
        vscode.commands.registerCommand(
            "superset.cliLauncherClearFilter",
            () => {
                applyFilter(provider, view, "");
            }
        ),
        vscode.commands.registerCommand(
            "superset.cliLauncherCopyAllPaths",
            async () => {
                await copyAllPathsToClipboard(provider.filter);
            }
        ),
        vscode.commands.registerCommand(
            "superset.cliLauncherAddPath",
            async () => {
                await addPathInteractively();
            }
        ),
        vscode.commands.registerCommand(
            "superset.cliLauncherRemovePath",
            async (target: unknown) => {
                await removePathInteractively(target);
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
            "superset.cliLauncherClearFilter",
            "superset.cliLauncherCopyAllPaths",
            "superset.cliLauncherAddPath",
            "superset.cliLauncherRemovePath",
            "superset.cliLauncherOpen",
            ...AGENT_IDS.map((agent) => AGENT_COMMAND_IDS[agent]),
        ].join(", ")}`
    );

    return {
        dispose() {
            for (const disposable of disposables) {
                disposable.dispose();
            }
            // context key 是 window 層狀態,view 消失後不得留下 stale true。
            void setFilterContext(false);
            // module-level sink 不得存活到下一輪 activation。
            setCLILauncherLog(undefined);
        },
    };
}

function setFilterContext(active: boolean): Thenable<unknown> {
    return vscode.commands.executeCommand(
        "setContext",
        FILTER_CONTEXT_KEY,
        active
    );
}

/**
 * 套用過濾字串:更新 provider、把目前條件寫進 view 的 description (面板標題右側),
 * 並同步 `Clear Filter` 的 context key。
 */
function applyFilter(
    provider: CLILauncherTreeProvider,
    view: vscode.TreeView<CLIEntryTreeItem>,
    raw: string
): void {
    provider.setFilter(raw);
    const active = provider.filter !== "";
    view.description = active ? `filter: ${provider.filter}` : undefined;
    void setFilterContext(active);
    log(`filter: ${active ? provider.filter : "(cleared)"}`);
}

/**
 * `Filter Paths`:輸入框接受 subsequence 查詢 (`plsup` → `platform/superset`)。
 * 送出空字串等同清除;按 Esc 取消則維持原本的條件。
 *
 * 刻意用一次性的 `showInputBox` 而不是逐鍵即時過濾:掃描結果沒有快取
 * (`Reset Caches` == 重新掃描),每個按鍵都重掃 root 會把 readdir 打成熱路徑。
 */
async function filterInteractively(
    provider: CLILauncherTreeProvider,
    view: vscode.TreeView<CLIEntryTreeItem>
): Promise<void> {
    const input = await vscode.window.showInputBox({
        title: "CLI: 過濾路徑",
        prompt: "逐段比對:字元在同一段內依序出現即命中,留白清除過濾。",
        placeHolder: "例如 tool → tools,pl/sup → ~/projects/platform/superset",
        value: provider.filter,
    });
    if (input === undefined) {
        return;
    }
    applyFilter(provider, view, input);
}

interface CommandContext {
    /** 右鍵／inline 按鈕點到的那一列。 */
    target: unknown;
    /** 多選時 VS Code 額外帶入的整份選取。 */
    targets?: unknown[];
    /** keybinding 觸發時沒有任何參數,只能回頭問 tree view 目前選了什麼。 */
    view: vscode.TreeView<CLIEntryTreeItem>;
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
 * 解析要啟動哪些項目,優先序:
 *  1. 多選命令參數 (`targets`) —— 右鍵一份選取時 VS Code 會帶進來
 *  2. 單一命令參數 (`target`) —— inline 按鈕只作用在被點到的那一列
 *  3. tree view 目前的選取 —— ctrl+1/2/3 之類的 keybinding 沒有參數
 *  4. quick pick —— 從 Command Palette 呼叫且面板沒有選取
 */
async function resolveEntries(context: CommandContext): Promise<CLIEntry[]> {
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

    const picked = await pickEntry("選擇路徑");
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
 * quick pick 的候選 = 手動釘選的路徑 + 掃描出的兩層資料夾,順序與面板一致。
 * 從 Command Palette 呼叫時才會走到這裡。
 */
async function listAllEntries(): Promise<CLIEntry[]> {
    const home = os.homedir();
    const pinned = loadEntries();
    const seen = new Set(pinned.map((entry) => entry.path));
    const entries = [...pinned];

    for (const folder of await scanRoots(loadRoots(), home)) {
        for (const candidate of [folder.entry, ...folder.children]) {
            if (!seen.has(candidate.path)) {
                seen.add(candidate.path);
                entries.push(candidate);
            }
        }
    }

    return entries;
}

/**
 * `Copy All Paths`:把面板目前顯示的每一個項目 (釘選 + 掃描兩層,與 tree view
 * 的渲染順序一致) 的絕對路徑各佔一行寫進剪貼簿。不看選取狀態 —— 這是「複製全部」,
 * 不是「複製選取」;但「全部」以面板`當下可見`為準,因此套用作用中的過濾條件。
 */
async function copyAllPathsToClipboard(filter: string): Promise<void> {
    const commandID = "superset.cliLauncherCopyAllPaths";
    log(`${commandID}: invoked (filter=${filter === "" ? "none" : filter})`);
    try {
        const entries = filterCLIEntries(
            await listAllEntries(),
            filter,
            os.homedir()
        );
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

async function removePathInteractively(target: unknown): Promise<void> {
    // 只有釘選的路徑能移除;掃描出來的資料夾要靠
    // `superset.cliLauncher.roots` 調整。
    const entry = toCLIEntry(target) ?? (await pickPinnedEntry());
    if (!entry) {
        return;
    }

    const confirmed = await vscode.window.showWarningMessage(
        `取消釘選「${entry.label}」?`,
        { modal: true },
        "取消釘選"
    );
    if (confirmed !== "取消釘選") {
        return;
    }

    if (!(await removeEntry(entry.path))) {
        await vscode.window.showInformationMessage(
            "CLI: 此資料夾來自 superset.cliLauncher.roots 掃描,不在釘選清單內。"
        );
    }
}

async function pickPinnedEntry(): Promise<CLIEntry | undefined> {
    const pinned = loadEntries();
    if (pinned.length === 0) {
        await vscode.window.showInformationMessage("CLI: 沒有釘選的路徑。");
        return undefined;
    }

    const home = os.homedir();
    const picked = await vscode.window.showQuickPick(
        pinned.map((entry) => ({
            label: entry.label,
            description: collapseHome(entry.path, home),
            entry,
        })),
        { placeHolder: "選擇要取消釘選的路徑" }
    );
    return picked?.entry;
}
