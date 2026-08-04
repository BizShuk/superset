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
    normalizeHiddenPaths,
    normalizeRootPaths,
    removeEntryPath,
    removeHiddenPath,
    type CLIEntry,
    type RawCLIEntry,
} from "./entries";
import { resolveAgentCommands, type AgentCommands } from "./command";

export const CONFIG_SECTION = "superset.cliLauncher";
const ENTRIES_KEY = "entries";
const ROOTS_KEY = "roots";
const HIDDEN_KEY = "hidden";
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

/** 讀取被使用者從面板移除的掃描路徑。 */
export function loadHiddenPaths(): string[] {
    return normalizeHiddenPaths(rawHidden(), homeDir());
}

async function writeHidden(next: string[]): Promise<void> {
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

/** 還原被移除的路徑;不在清單裡時回傳 `false`,不動設定。 */
export async function unhidePath(targetPath: string): Promise<boolean> {
    const next = removeHiddenPath(rawHidden(), targetPath, homeDir());
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

async function writeEntries(next: RawCLIEntry[]): Promise<void> {
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
