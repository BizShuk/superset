// CLI Launcher 自己建立的 terminal registry。
//
// 一個 `(path, agent)` 可以同時有多個 terminal：前一個 agent 還在 busy 時再次
// launch，必須保留舊 terminal 並建立新 terminal，不能用 map overwrite 遺失。
// 這裡只追蹤本次 Extension Host runtime 由 CLI Launcher 建立的 terminals；不掃描
// `vscode.window.terminals`，也不猜其他 terminal 的 cwd。

import * as vscode from "vscode";
import type { AgentId } from "./command";
import { log } from "./log";

export type CLITerminalPhase = "idle" | "pending" | "running";

export interface TrackedCLITerminal {
    readonly id: string;
    readonly path: string;
    readonly agent?: AgentId;
    readonly terminal: vscode.Terminal;
    readonly phase: CLITerminalPhase;
}

interface MutableTrackedTerminal {
    id: string;
    path: string;
    agent?: AgentId;
    terminal: vscode.Terminal;
    phase: CLITerminalPhase;
}

/**
 * 擁有 CLI terminal metadata、reuse lookup 與 VS Code lifecycle listeners。
 * `onDidChange` 只送出受影響的 path，讓 Tree provider 不必重掃所有 roots/Git。
 */
export class CLITerminalTracker implements vscode.Disposable {
    private readonly records = new Map<
        vscode.Terminal,
        MutableTrackedTerminal
    >();
    private readonly paths = new Map<string, Set<MutableTrackedTerminal>>();
    private readonly changed = new vscode.EventEmitter<string>();
    private readonly subscriptions: vscode.Disposable[];
    private nextID = 1;
    private disposed = false;

    readonly onDidChange = this.changed.event;

    constructor() {
        this.subscriptions = [
            vscode.window.onDidCloseTerminal((terminal) => {
                this.remove(terminal);
            }),
            vscode.window.onDidStartTerminalShellExecution((event) => {
                const tracked = this.records.get(event.terminal);
                if (tracked?.phase !== "pending") {
                    return;
                }
                this.setPhase(tracked, "running");
                log(`terminal: shell-started "${event.terminal.name}"`);
            }),
            vscode.window.onDidEndTerminalShellExecution((event) => {
                const tracked = this.records.get(event.terminal);
                if (tracked?.phase !== "running") {
                    return;
                }
                this.setPhase(tracked, "idle");
                log(
                    `terminal: shell-ended "${event.terminal.name}" exit=${
                        event.exitCode ?? "unknown"
                    }`
                );
            }),
        ];
    }

    track(
        path: string,
        agent: AgentId | undefined,
        terminal: vscode.Terminal
    ): void {
        if (this.records.has(terminal)) {
            return;
        }
        const tracked: MutableTrackedTerminal = {
            id: `cli-terminal:${this.nextID}`,
            path,
            agent,
            terminal,
            phase: "idle",
        };
        this.nextID += 1;
        this.records.set(terminal, tracked);
        const pathRecords = this.paths.get(path) ?? new Set();
        pathRecords.add(tracked);
        this.paths.set(path, pathRecords);
        this.changed.fire(path);
    }

    /** 最近建立的 idle terminal 優先 reuse，延續使用者最近操作的分頁。 */
    findReusable(path: string, agent?: AgentId): vscode.Terminal | undefined {
        const records = [...(this.paths.get(path) ?? [])];
        for (let index = records.length - 1; index >= 0; index -= 1) {
            const tracked = records[index];
            if (
                tracked.agent === agent &&
                tracked.phase === "idle" &&
                tracked.terminal.exitStatus === undefined
            ) {
                return tracked.terminal;
            }
        }
        return undefined;
    }

    markPending(terminal: vscode.Terminal): void {
        const tracked = this.records.get(terminal);
        if (tracked?.phase === "idle") {
            this.setPhase(tracked, "pending");
        }
    }

    getByPath(path: string): TrackedCLITerminal[] {
        const found: TrackedCLITerminal[] = [];
        for (const tracked of this.paths.get(path) ?? []) {
            if (tracked.terminal.exitStatus === undefined) {
                found.push({ ...tracked });
            }
        }
        return found;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.subscriptions.length = 0;
        this.records.clear();
        this.paths.clear();
        this.changed.dispose();
    }

    private remove(terminal: vscode.Terminal): void {
        const tracked = this.records.get(terminal);
        if (!tracked) {
            return;
        }
        this.records.delete(terminal);
        const pathRecords = this.paths.get(tracked.path);
        pathRecords?.delete(tracked);
        if (pathRecords?.size === 0) {
            this.paths.delete(tracked.path);
        }
        this.changed.fire(tracked.path);
    }

    private setPhase(
        tracked: MutableTrackedTerminal,
        phase: CLITerminalPhase
    ): void {
        if (tracked.phase === phase) {
            return;
        }
        tracked.phase = phase;
        this.changed.fire(tracked.path);
    }
}
