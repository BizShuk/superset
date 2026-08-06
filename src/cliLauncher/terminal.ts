// 依項目開啟／重用 terminal 並送出命令。
//
// 重用候選依 (path, agent) 分組,只選最近建立且「閒置」的 terminal —— agent
// (claude / codex / grok) 還在跑 TUI 時送命令只會把文字打進 TUI 的 stdin,看起來
// 就是「按了沒反應」。全部 busy 時保留每筆舊 record 並開新 terminal；使用者關閉
// terminal 後由 onDidCloseTerminal 清掉精確 record。
//
// terminal 本身一律由 VS Code 擁有:建立走 `terminals/nativeTerminal.ts` 這個
// 唯一的 `createTerminal` call site,這裡只在外部觀察它的生命週期。

import * as vscode from "vscode";
import type { PluginContext } from "../plugin";
import { buildShellCommand, terminalNameFor, type AgentId } from "./command";
import type { CLIEntry } from "./entries";
import { log } from "./log";
import { CLITerminalTracker } from "./terminalTracker";

const SHELL_INTEGRATION_WAIT_MS = 3_000;

interface ActiveTerminalRuntime {
    readonly tracker: CLITerminalTracker;
    readonly createTerminal: PluginContext["createTerminal"];
}

let activeRuntime: ActiveTerminalRuntime | undefined;

/**
 * 註冊 terminal 生命週期監聽:關閉時移出追蹤、shell execution start/end 驅動
 * pending → running → idle。沒有 shell integration 的 terminal 不會發出事件,會
 * 維持 pending —— 之後每次啟動都開新 terminal,寧可多一個分頁也不把命令打進
 * 看不見的 TUI。
 *
 * 監聽器推進 feature 的 disposable pool,extension host reload 時一併釋放;
 * 追蹤表也在此清空,避免上一輪 runtime 的 terminal 被誤判為可重用。
 */
export function initTerminalTracking(
    registerDisposable: (disposable: vscode.Disposable) => void,
    createTerminal: PluginContext["createTerminal"]
): CLITerminalTracker {
    activeRuntime?.tracker.dispose();
    const tracker = new CLITerminalTracker();
    const runtime = { tracker, createTerminal };
    activeRuntime = runtime;
    registerDisposable({
        dispose: () => {
            tracker.dispose();
            if (activeRuntime === runtime) {
                activeRuntime = undefined;
            }
        },
    });
    return tracker;
}

function getActiveRuntime(): ActiveTerminalRuntime {
    if (!activeRuntime) {
        throw new Error("CLI terminal tracking is not initialized");
    }
    return activeRuntime;
}

interface TerminalResolution {
    terminal: vscode.Terminal;
    created: boolean;
}

function findOrCreateTerminal(
    entry: CLIEntry,
    agent?: AgentId
): TerminalResolution {
    const { tracker, createTerminal } = getActiveRuntime();
    const name = terminalNameFor(entry.label, agent);
    const reusable = tracker.findReusable(entry.path, agent);
    if (reusable) {
        log(`terminal: reusing "${name}"`);
        return { terminal: reusable, created: false };
    }
    const hasBusy = tracker
        .getByPath(entry.path)
        .some((tracked) => tracked.agent === agent && tracked.phase !== "idle");
    if (hasBusy) {
        log(
            `terminal: "${name}" is busy running its command, creating a fresh one`
        );
    } else {
        log(`terminal: creating "${name}" cwd=${entry.path} location=editor`);
    }
    // `location: {viewColumn}` 讓 terminal 開在 editor area 成為一個分頁,而不是
    // 底部 panel。CLI (claude / codex / grok) 是全螢幕 TUI,吃得下編輯區的高度;
    // 多選啟動時每個項目也各自是一個分頁,比擠在 panel 裡好切換。
    const terminal = createTerminal(name, entry.path, {
        location: { viewColumn: vscode.ViewColumn.Active },
    });
    tracker.track(entry.path, agent, terminal);
    return { terminal, created: true };
}

/**
 * 新 terminal 的 shell integration 必定先是 undefined。等待 activation event,
 * 把它當成 shell readiness signal;若使用者的 shell 不支援 integration,三秒後
 * 繼續用 sendText。等待期間 terminal 關閉時立即拒絕,不對已死 terminal 送文字。
 */
function waitForTerminalReady(terminal: vscode.Terminal): Promise<void> {
    if (terminal.exitStatus !== undefined) {
        return Promise.reject(terminalClosedError(terminal));
    }
    if (terminal.shellIntegration) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        let integrationSubscription: vscode.Disposable | undefined;
        let closeSubscription: vscode.Disposable | undefined;

        const finish = (error?: Error): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            integrationSubscription?.dispose();
            closeSubscription?.dispose();
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };

        const timer = setTimeout(() => {
            finish(
                terminal.exitStatus === undefined
                    ? undefined
                    : terminalClosedError(terminal)
            );
        }, SHELL_INTEGRATION_WAIT_MS);

        integrationSubscription =
            vscode.window.onDidChangeTerminalShellIntegration((event) => {
                if (event.terminal === terminal) {
                    finish();
                }
            });
        closeSubscription = vscode.window.onDidCloseTerminal(
            (closedTerminal) => {
                if (closedTerminal === terminal) {
                    finish(terminalClosedError(terminal));
                }
            }
        );

        if (terminal.exitStatus !== undefined) {
            finish(terminalClosedError(terminal));
        }
    });
}

function terminalClosedError(terminal: vscode.Terminal): Error {
    return new Error(
        `Terminal "${terminal.name}" closed before command could be sent`
    );
}

async function sendTerminalLine(
    terminal: vscode.Terminal,
    line: string,
    waitUntilReady: boolean
): Promise<void> {
    if (waitUntilReady) {
        await waitForTerminalReady(terminal);
    }
    if (terminal.exitStatus !== undefined) {
        throw terminalClosedError(terminal);
    }

    terminal.sendText(line, true);
    log(`terminal: sent ${JSON.stringify(line)}`);
}

export interface LaunchOptions {
    /** 決定 terminal 名稱後綴;省略時是「單純開一個 terminal」。 */
    agent?: AgentId;
    /** 是否把游標帶到該 terminal。多選啟動時只有最後一個 reveal。 */
    reveal?: boolean;
}

/**
 * 在項目的路徑下執行命令。命令自帶 `cd`,所以即使 terminal 被重用且 cwd 已改變,
 * 也一定在正確目錄下執行。送出非空命令後立即標記 busy (在 await 之前),
 * 連點兩下也不會把第二份命令打進同一個 terminal。
 */
export async function launch(
    entry: CLIEntry,
    command: string,
    options: LaunchOptions = {}
): Promise<vscode.Terminal> {
    const { tracker } = getActiveRuntime();
    const { terminal, created } = findOrCreateTerminal(entry, options.agent);
    const line = buildShellCommand(entry.path, command);
    if (options.reveal ?? true) {
        terminal.show(false);
    }
    if (command.trim() !== "") {
        tracker.markPending(terminal);
    }
    await sendTerminalLine(terminal, line, created);
    return terminal;
}

/**
 * 一次啟動多個項目 (tree view 多選)。每個項目各自一個 terminal,
 * 只有最後一個會 reveal,避免逐個搶焦點。
 */
export async function launchAll(
    entries: readonly CLIEntry[],
    command: string,
    agent?: AgentId
): Promise<vscode.Terminal[]> {
    return Promise.all(
        entries.map((entry, index) =>
            launch(entry, command, {
                agent,
                reveal: index === entries.length - 1,
            })
        )
    );
}
