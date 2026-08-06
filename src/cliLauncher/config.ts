// settings 讀寫的唯一入口 (VS Code adapter)。
//
// 路徑清單是「跨 workspace 的系統層設定」,因此一律寫入 Global (User settings),
// 不會因為切換專案而消失。純粹的資料規則都委派給 `entries.ts`。

import * as os from "node:os";
import * as vscode from "vscode";
import {
    appendEntryPath,
    appendHiddenPath,
    normalizeEntries,
    normalizeEntrySelectors,
    normalizeHiddenRules,
    normalizeRootPaths,
    removeEntryPath,
    removeHiddenRule as removeHiddenRuleFromRaw,
    type CLIEntry,
    type EntrySelector,
    type HiddenRule,
    type RawEntrySetting,
    type RawHiddenRule,
} from "./entries";
import { resolveAgentCommands, type AgentCommands } from "./command";
import {
    appendFocusedPath as appendFocusedPathToRaw,
    normalizeFocusedPaths,
    removeFocusedPath as removeFocusedPathFromRaw,
} from "./focus";

export const CONFIG_SECTION = "superset.cliLauncher";
const ENTRIES_KEY = "entries";
const ROOTS_KEY = "roots";
const HIDDEN_KEY = "hidden";
const FOCUSED_KEY = "focused";
const FOCUSED_ONLY_KEY = "focusedOnly";
const AGENT_COMMANDS_KEY = "agentCommands";

/** 預設掃描 `~/projects`,對齊「兩層佈局」的目錄慣例。 */
export const DEFAULT_ROOTS = ["~/projects"];

function homeDir(): string {
    return os.homedir();
}

function rawEntries(): unknown {
    return vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<unknown>(ENTRIES_KEY, []);
}

/** 讀取並正規化目前的路徑清單。 */
export function loadEntries(): CLIEntry[] {
    return normalizeEntries(rawEntries(), homeDir());
}

/** 讀取 literal entries 與兩層 scan candidates 使用的 Regex selectors。 */
export function loadEntrySelectors(): EntrySelector[] {
    return normalizeEntrySelectors(rawEntries(), homeDir());
}

/** 讀取要掃描兩層資料夾的根目錄清單。 */
export function loadRoots(): string[] {
    const raw = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<unknown>(ROOTS_KEY, DEFAULT_ROOTS);
    return normalizeRootPaths(raw, homeDir());
}

function rawHidden(): unknown {
    return vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<unknown>(HIDDEN_KEY, []);
}

/** 讀取 literal ancestor paths 與 Regex hidden rules。 */
export function loadHiddenRules(): HiddenRule[] {
    return normalizeHiddenRules(rawHidden(), homeDir());
}

function rawFocused(): unknown {
    return vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<unknown>(FOCUSED_KEY, []);
}

/** 讀取 exact literal Focus list。 */
export function loadFocusedPaths(): string[] {
    return normalizeFocusedPaths(rawFocused(), homeDir());
}

/** 是否只投影 Focused paths。 */
export function loadFocusedOnly(): boolean {
    return (
        vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .get<unknown>(FOCUSED_ONLY_KEY, false) === true
    );
}

async function writeFocused(next: string[]): Promise<void> {
    await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(FOCUSED_KEY, next, vscode.ConfigurationTarget.Global);
}

/** 加入 Focus list；已存在時不寫設定。 */
export async function addFocusedPath(targetPath: string): Promise<boolean> {
    const next = appendFocusedPathToRaw(rawFocused(), targetPath, homeDir());
    if (!next) {
        return false;
    }
    await writeFocused(next);
    return true;
}

/** 移出 Focus list；找不到時不寫設定。 */
export async function removeFocusedPath(targetPath: string): Promise<boolean> {
    const next = removeFocusedPathFromRaw(rawFocused(), targetPath, homeDir());
    if (!next) {
        return false;
    }
    await writeFocused(next);
    return true;
}

/** 切換 Focus-only projection；狀態相同時不寫設定。 */
export async function setFocusedOnly(active: boolean): Promise<boolean> {
    if (loadFocusedOnly() === active) {
        return false;
    }
    await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(
            FOCUSED_ONLY_KEY,
            active,
            vscode.ConfigurationTarget.Global
        );
    return true;
}

async function writeHidden(next: RawHiddenRule[]): Promise<void> {
    await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(HIDDEN_KEY, next, vscode.ConfigurationTarget.Global);
}

/** 把掃描出來的路徑從面板移除;已經移除過時回傳 `false`,不動設定。 */
export async function hidePath(targetPath: string): Promise<boolean> {
    const next = appendHiddenPath(rawHidden(), targetPath, homeDir());
    if (!next) {
        return false;
    }
    await writeHidden(next);
    return true;
}

/** 還原 literal 或 Regex hidden rule；找不到時不寫入設定。 */
export async function unhideRule(target: HiddenRule): Promise<boolean> {
    const next = removeHiddenRuleFromRaw(rawHidden(), target, homeDir());
    if (!next) {
        return false;
    }
    await writeHidden(next);
    return true;
}

/** 讀取三顆 agent 按鈕實際要執行的命令。 */
export function loadAgentCommands(): AgentCommands {
    const raw = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<unknown>(AGENT_COMMANDS_KEY, {});
    return resolveAgentCommands(raw);
}

async function writeEntries(next: RawEntrySetting[]): Promise<void> {
    await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(ENTRIES_KEY, next, vscode.ConfigurationTarget.Global);
}

/** 新增路徑;已存在時回傳 `false`,不動設定。 */
export async function addEntry(newPath: string): Promise<boolean> {
    const next = appendEntryPath(rawEntries(), newPath, homeDir());
    if (!next) {
        return false;
    }
    await writeEntries(next);
    return true;
}

/** 移除路徑;找不到時回傳 `false`,不動設定。 */
export async function removeEntry(targetPath: string): Promise<boolean> {
    const next = removeEntryPath(rawEntries(), targetPath, homeDir());
    if (!next) {
        return false;
    }
    await writeEntries(next);
    return true;
}
