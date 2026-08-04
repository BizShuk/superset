import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeTerminal {
    name: string;
    cwd?: string;
    location?: unknown;
    exitStatus?: { code: number | undefined };
    processId: Promise<number | undefined>;
    shellIntegration?: FakeShellIntegration;
    show: ReturnType<typeof vi.fn>;
    sendText: ReturnType<typeof vi.fn>;
}

interface FakeShellIntegration {
    executeCommand: ReturnType<typeof vi.fn>;
}

// vi.mock 的 factory 會被 hoist 到檔首,所以共享狀態必須用 vi.hoisted 建立。
const {
    terminals,
    createTerminal,
    shellIntegrationListeners,
    closeListeners,
    startExecutionListeners,
    endExecutionListeners,
    terminalCreationState,
} = vi.hoisted(() => {
    const list: FakeTerminal[] = [];
    const creationState = { withShellIntegration: true };
    const listeners: Array<
        (event: {
            terminal: FakeTerminal;
            shellIntegration: FakeShellIntegration;
        }) => void
    > = [];
    const onClose: Array<(terminal: FakeTerminal) => void> = [];
    const onStartExecution: Array<(event: { terminal: FakeTerminal }) => void> =
        [];
    const onEndExecution: Array<
        (event: { terminal: FakeTerminal; exitCode?: number }) => void
    > = [];
    const factory = vi.fn(
        (options: { name: string; cwd?: string; location?: unknown }) => {
            const terminal: FakeTerminal = {
                name: options.name,
                cwd: options.cwd,
                location: options.location,
                exitStatus: undefined,
                processId: Promise.resolve(1000 + list.length),
                shellIntegration: creationState.withShellIntegration
                    ? { executeCommand: vi.fn() }
                    : undefined,
                show: vi.fn(),
                sendText: vi.fn(),
            };
            list.push(terminal);
            return terminal;
        }
    );
    return {
        terminals: list,
        createTerminal: factory,
        shellIntegrationListeners: listeners,
        closeListeners: onClose,
        startExecutionListeners: onStartExecution,
        endExecutionListeners: onEndExecution,
        terminalCreationState: creationState,
    };
});

vi.mock("vscode", () => ({
    window: {
        get terminals() {
            return terminals;
        },
        createTerminal,
        onDidChangeTerminalShellIntegration: vi.fn(
            (
                listener: (event: {
                    terminal: FakeTerminal;
                    shellIntegration: FakeShellIntegration;
                }) => void
            ) => {
                shellIntegrationListeners.push(listener);
                return { dispose: vi.fn() };
            }
        ),
        onDidCloseTerminal: vi.fn(
            (listener: (terminal: FakeTerminal) => void) => {
                closeListeners.push(listener);
                return { dispose: vi.fn() };
            }
        ),
        onDidStartTerminalShellExecution: vi.fn(
            (listener: (event: { terminal: FakeTerminal }) => void) => {
                startExecutionListeners.push(listener);
                return { dispose: vi.fn() };
            }
        ),
        onDidEndTerminalShellExecution: vi.fn(
            (
                listener: (event: {
                    terminal: FakeTerminal;
                    exitCode?: number;
                }) => void
            ) => {
                endExecutionListeners.push(listener);
                return { dispose: vi.fn() };
            }
        ),
    },
    ViewColumn: { Active: -1 },
}));

import {
    initTerminalTracking,
    launch,
    launchAll,
} from "../src/cliLauncher/terminal";

const ENTRY = {
    id: "/opt/web",
    label: "web",
    path: "/opt/web",
};

/** 模擬該 terminal 收到 shell execution start acknowledgement。 */
function startExecution(terminal: FakeTerminal): void {
    for (const listener of startExecutionListeners) {
        listener({ terminal });
    }
}

/** 模擬該 terminal 內的 shell execution 結束 (agent 退出、回到 prompt)。 */
function endExecution(terminal: FakeTerminal): void {
    for (const listener of endExecutionListeners) {
        listener({ terminal, exitCode: 0 });
    }
}

/** 模擬使用者關閉 terminal。 */
function closeTerminal(terminal: FakeTerminal): void {
    terminal.exitStatus = { code: 0 };
    for (const listener of closeListeners) {
        listener(terminal);
    }
}

beforeEach(() => {
    terminals.length = 0;
    shellIntegrationListeners.length = 0;
    closeListeners.length = 0;
    startExecutionListeners.length = 0;
    endExecutionListeners.length = 0;
    terminalCreationState.withShellIntegration = true;
    createTerminal.mockClear();
    // 清空 module-level 追蹤狀態並重新掛 lifecycle 監聽。
    initTerminalTracking([]);
});

describe("launch", () => {
    it("creates a terminal at the entry path and sends a visible cd-prefixed command", async () => {
        await launch(ENTRY, "claude", { agent: "claude" });

        expect(createTerminal).toHaveBeenCalledWith({
            name: "web · claude",
            cwd: "/opt/web",
            // editor area,不是底部 panel。
            location: { viewColumn: -1 },
        });
        // preserveFocus=false:啟動 CLI 後游標要直接落在 terminal 才能互動。
        expect(terminals[0].show).toHaveBeenCalledWith(false);
        expect(terminals[0].sendText).toHaveBeenCalledWith(
            `cd '/opt/web' && claude`,
            true
        );
        expect(
            terminals[0].shellIntegration?.executeCommand
        ).not.toHaveBeenCalled();
    });

    it("waits for shell integration before sending a visible command in a new terminal", async () => {
        terminalCreationState.withShellIntegration = false;
        const launched = launch(ENTRY, "claude", { agent: "claude" });

        expect(terminals[0].sendText).not.toHaveBeenCalled();

        const shellIntegration: FakeShellIntegration = {
            executeCommand: vi.fn(),
        };
        terminals[0].shellIntegration = shellIntegration;
        expect(shellIntegrationListeners[0]).toBeDefined();
        shellIntegrationListeners[0]!({
            terminal: terminals[0],
            shellIntegration,
        });

        await launched;

        expect(terminals[0].sendText).toHaveBeenCalledWith(
            `cd '/opt/web' && claude`,
            true
        );
        expect(shellIntegration.executeCommand).not.toHaveBeenCalled();
    });

    it("falls back to sendText when shell integration does not activate", async () => {
        vi.useFakeTimers();
        terminalCreationState.withShellIntegration = false;

        try {
            const launched = launch(ENTRY, "claude", { agent: "claude" });

            expect(terminals[0].sendText).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(3_000);
            await launched;

            expect(terminals[0].sendText).toHaveBeenCalledWith(
                `cd '/opt/web' && claude`,
                true
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not send a command when the terminal closes while waiting for readiness", async () => {
        vi.useFakeTimers();
        terminalCreationState.withShellIntegration = false;

        try {
            const launched = launch(ENTRY, "claude", { agent: "claude" });
            const rejected = expect(launched).rejects.toThrow(
                'Terminal "web · claude" closed before command could be sent'
            );

            closeTerminal(terminals[0]);
            await vi.runAllTimersAsync();
            await rejected;

            expect(terminals[0].sendText).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("reuses the terminal after its previous command has finished", async () => {
        await launch(ENTRY, "claude", { agent: "claude" });
        startExecution(terminals[0]);
        endExecution(terminals[0]);
        await launch(ENTRY, "claude", { agent: "claude" });

        expect(createTerminal).toHaveBeenCalledTimes(1);
        expect(terminals[0].sendText).toHaveBeenCalledTimes(2);
    });

    it("does not clear pending busy state for an end event without a start event", async () => {
        await launch(ENTRY, "claude", { agent: "claude" });
        endExecution(terminals[0]);
        await launch(ENTRY, "claude", { agent: "claude" });

        expect(createTerminal).toHaveBeenCalledTimes(2);
    });

    it("creates a fresh terminal instead of typing into a busy agent TUI", async () => {
        await launch(ENTRY, "claude", { agent: "claude" });
        // 沒有 endExecution:claude 還在跑,命令不得打進它的 stdin。
        await launch(ENTRY, "claude", { agent: "claude" });

        expect(createTerminal).toHaveBeenCalledTimes(2);
        expect(terminals[0].sendText).toHaveBeenCalledTimes(1);
        expect(terminals[1].sendText).toHaveBeenCalledWith(
            `cd '/opt/web' && claude`,
            true
        );
    });

    it("does not share terminals between entries with the same label", async () => {
        const other = { id: "/srv/web", label: "web", path: "/srv/web" };
        await launch(ENTRY, "claude", { agent: "claude" });
        endExecution(terminals[0]);
        await launch(other, "claude", { agent: "claude" });

        expect(createTerminal).toHaveBeenCalledTimes(2);
        expect(terminals[1].sendText).toHaveBeenCalledWith(
            `cd '/srv/web' && claude`,
            true
        );
    });

    it("keeps each agent on its own terminal, separate from the plain open", async () => {
        await launch(ENTRY, "claude", { agent: "claude" });
        await launch(ENTRY, "codex", { agent: "codex" });
        await launch(ENTRY, "grok", { agent: "grok" });
        await launch(ENTRY, "");

        expect(terminals.map((terminal) => terminal.name)).toEqual([
            "web · claude",
            "web · codex",
            "web · grok",
            "web",
        ]);
        expect(terminals[2].sendText).toHaveBeenCalledWith(
            `cd '/opt/web' && grok`,
            true
        );
    });

    it("does not reuse an exited terminal", async () => {
        await launch(ENTRY, "claude", { agent: "claude" });
        terminals[0].exitStatus = { code: 0 };
        await launch(ENTRY, "claude", { agent: "claude" });

        expect(createTerminal).toHaveBeenCalledTimes(2);
    });

    it("recreates a terminal after the user closes it", async () => {
        await launch(ENTRY, "claude", { agent: "claude" });
        closeTerminal(terminals[0]);
        await launch(ENTRY, "claude", { agent: "claude" });

        expect(createTerminal).toHaveBeenCalledTimes(2);
        expect(terminals[1].sendText).toHaveBeenCalledWith(
            `cd '/opt/web' && claude`,
            true
        );
    });

    it("skips reveal when asked to stay in the background", async () => {
        await launch(ENTRY, "claude", { agent: "claude", reveal: false });

        expect(terminals[0].show).not.toHaveBeenCalled();
        expect(terminals[0].sendText).toHaveBeenCalledWith(
            `cd '/opt/web' && claude`,
            true
        );
    });

    it("executes only cd when opening a plain terminal", async () => {
        await launch(ENTRY, "");

        expect(terminals[0].sendText).toHaveBeenCalledWith(`cd '/opt/web'`, true);
    });

    it("keeps reusing a plain terminal because cd never marks it busy", async () => {
        await launch(ENTRY, "");
        await launch(ENTRY, "");

        expect(createTerminal).toHaveBeenCalledTimes(1);
        expect(terminals[0].sendText).toHaveBeenCalledTimes(2);
    });
});

describe("launchAll", () => {
    const ENTRIES = [
        { id: "/opt/web", label: "web", path: "/opt/web" },
        { id: "/opt/api", label: "api", path: "/opt/api" },
        { id: "/opt/cli", label: "cli", path: "/opt/cli" },
    ];

    it("opens one terminal per selected entry and runs the agent in each", async () => {
        await launchAll(ENTRIES, "claude", "claude");

        expect(terminals.map((terminal) => terminal.name)).toEqual([
            "web · claude",
            "api · claude",
            "cli · claude",
        ]);
        expect(terminals[1].sendText).toHaveBeenCalledWith(
            `cd '/opt/api' && claude`,
            true
        );
    });

    it("reveals only the last terminal so the earlier ones do not steal focus", async () => {
        await launchAll(ENTRIES, "codex", "codex");

        expect(terminals[0].show).not.toHaveBeenCalled();
        expect(terminals[1].show).not.toHaveBeenCalled();
        expect(terminals[2].show).toHaveBeenCalledWith(false);
    });

    it("does nothing for an empty selection", async () => {
        await expect(launchAll([], "grok", "grok")).resolves.toEqual([]);
        expect(createTerminal).not.toHaveBeenCalled();
    });

    it("opens every terminal in the editor area", async () => {
        await launchAll(ENTRIES, "claude", "claude");

        expect(
            terminals.every(
                (terminal) =>
                    JSON.stringify(terminal.location) ===
                    JSON.stringify({ viewColumn: -1 })
            )
        ).toBe(true);
    });
});
