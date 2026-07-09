// Tests for the global-commands install commands. These are the ones
// that previously opened a plain `vscode.window.createTerminal` and
// got bitten by the auto-PTY layer (it disposes the original terminal
// 150ms after creating its PTY-backed replacement, racing
// `terminal.sendText` and silently swallowing the command). The fix
// routes them through the terminals module's PTY-backed spawner via
// `terminalSpawner.ts`. As of 0.8.13 the install commands accept
// `{ closeOnSuccess: true }` — the cmdline is suffixed with
// `&& exit` so the shell self-terminates on success; the PTY host's
// `proc.onExit` then drives VSCode to remove the terminal tab. On
// non-zero exit the `&&` short-circuits and the terminal stays open
// for the user to read the error.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock vscode with just enough surface for the install commands to
// run. The terminals module's full activation path is exercised in
// `extensionActivate.test.ts`; here we only care that the install
// commands consult the spawner, do NOT call `createTerminal`, and
// append `&& exit` when `closeOnSuccess` is requested.
vi.mock("vscode", () => {
    class EventEmitter<T> {
        private listeners = new Set<(e: T) => void>();
        event = (listener: (e: T) => void) => {
            this.listeners.add(listener);
            return { dispose: () => this.listeners.delete(listener) };
        };
        fire(e: T) {
            for (const l of this.listeners) l(e);
        }
        dispose() {
            this.listeners.clear();
        }
    }
    const noop = () => {};
    const noopDisposable = { dispose: noop };
    const commands = new Map<string, (...args: unknown[]) => unknown>();
    return {
        EventEmitter,
        Uri: {
            file: (p: string) => ({ fsPath: p, scheme: "file", path: p }),
            parse: (s: string) => ({ fsPath: s, scheme: "url", path: s }),
        },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        window: {
            createOutputChannel: () => ({
                appendLine: noop,
                show: noop,
                dispose: noop,
            }),
            createStatusBarItem: () => ({
                text: "",
                tooltip: "",
                name: "",
                show: noop,
                hide: noop,
                dispose: noop,
            }),
            createTreeView: () => ({
                onDidChangeCheckboxState: undefined,
                title: "",
                dispose: noop,
            }),
            showInformationMessage: vi.fn(async () => "Install"),
            showWarningMessage: vi.fn(async () => "Reset"),
            showErrorMessage: vi.fn(async () => undefined),
            showInputBox: vi.fn(async () => undefined),
            showQuickPick: vi.fn(async () => undefined),
            // Track createTerminal calls so the test can assert the
            // install commands DO NOT use it.
            createTerminal: vi.fn((opts: { name: string; cwd?: string }) => {
                return {
                    name: opts.name,
                    cwd: opts.cwd,
                    show: vi.fn(),
                    sendText: vi.fn(),
                    dispose: vi.fn(),
                    processId: Promise.resolve(123),
                };
            }),
        },
        workspace: {
            workspaceFolders: [{ uri: { fsPath: "/ws" } }],
            onDidChangeWorkspaceFolders: () => noopDisposable,
            createFileSystemWatcher: () => ({
                onDidChange: () => noopDisposable,
                onDidCreate: () => noopDisposable,
                onDidDelete: () => noopDisposable,
                dispose: noop,
            }),
            openTextDocument: async () => ({}),
            getConfiguration: () => ({ get: () => undefined }),
        },
        env: {
            sessionId: "test-session",
            clipboard: { writeText: async () => {} },
        },
        commands: {
            registerCommand: (
                id: string,
                cb: (...args: unknown[]) => unknown
            ) => {
                commands.set(id, cb);
                return { dispose: () => commands.delete(id) };
            },
            executeCommand: async (id: string, ...args: unknown[]) => {
                const cb = commands.get(id);
                if (cb) return cb(...args);
            },
        },
        StatusBarAlignment: { Left: 0, Right: 1 },
        Disposable: { from: () => noopDisposable },
        // Test helpers
        __commands: commands,
    };
});

import * as vscode from "vscode";
import * as os from "os";
import {
    globalCommandsPlugin,
    setDiagnosticChannel,
    setPluginManager,
} from "../src/globalCommandsPlugin";
import {
    setTerminalSpawner,
    getTerminalSpawner,
} from "../src/terminals/terminalSpawner";

// A minimal `PluginContext` sufficient for the global-commands plugin
// to register its commands.
function fakePluginContext(): {
    extensionUri: vscode.Uri;
    workspaceFolder: string;
    workspaceState: vscode.Memento;
    globalState: vscode.Memento;
    log: (msg: string) => void;
    registerDisposable: (d: vscode.Disposable) => void;
} {
    return {
        extensionUri: { fsPath: "/fake" } as vscode.Uri,
        workspaceFolder: "/ws",
        workspaceState: {
            get: () => undefined,
            update: async () => {},
        } as unknown as vscode.Memento,
        globalState: {
            get: () => undefined,
            update: async () => {},
        } as unknown as vscode.Memento,
        log: () => {},
        registerDisposable: () => {},
    };
}

describe("terminalSpawner bridge", () => {
    beforeEach(() => {
        setTerminalSpawner(undefined);
        (vscode as unknown as { __commands: Map<string, unknown> }).__commands.clear();
        (
            vscode.window as unknown as { createTerminal: ReturnType<typeof vi.fn> }
        ).createTerminal.mockClear();
        ((vscode.window as unknown as { showInformationMessage: ReturnType<typeof vi.fn> })
            .showInformationMessage as ReturnType<typeof vi.fn>).mockClear();
        ((vscode.window as unknown as { showErrorMessage: ReturnType<typeof vi.fn> })
            .showErrorMessage as ReturnType<typeof vi.fn>).mockClear();
        // Reset the input-box mock too: the default in the vi.mock
        // returns undefined (Esc / dismissed), but a per-test
        // `mockResolvedValueOnce("...")` would leak across tests if
        // we don't clear the queue.
        ((vscode.window as unknown as { showInputBox: ReturnType<typeof vi.fn> })
            .showInputBox as ReturnType<typeof vi.fn>).mockReset();
        ((vscode.window as unknown as { showInputBox: ReturnType<typeof vi.fn> })
            .showInputBox as ReturnType<typeof vi.fn>).mockResolvedValue(
            undefined
        );
    });

    it("setTerminalSpawner / getTerminalSpawner round-trip", () => {
        const fake = vi.fn();
        setTerminalSpawner(fake);
        expect(getTerminalSpawner()).toBe(fake);
        setTerminalSpawner(undefined);
        expect(getTerminalSpawner()).toBeUndefined();
    });

    it("installDefaultTools spawns two separate terminals (one per go install), each cmdline suffixed with `&& exit`, and does NOT call createTerminal", async () => {
        const t1 = {
            name: "a",
            show: vi.fn(),
            sendText: vi.fn(),
            dispose: vi.fn(),
        } as unknown as vscode.Terminal;
        const t2 = {
            name: "b",
            show: vi.fn(),
            sendText: vi.fn(),
            dispose: vi.fn(),
        } as unknown as vscode.Terminal;
        const spawn = vi.fn()
            .mockReturnValueOnce(t1)
            .mockReturnValueOnce(t2);
        setTerminalSpawner(spawn);
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        const pCtx = fakePluginContext();
        globalCommandsPlugin.activate(pCtx as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.installDefaultTools")!;
        await cb();

        // Two spawn calls — pm2 first, skills second. Each gets its
        // own terminal so the user can watch them in parallel and
        // abort either with Ctrl-C without affecting the other.
        expect(spawn).toHaveBeenCalledTimes(2);
        const [name1, cwd1] = spawn.mock.calls[0] as [string, string];
        const [name2, cwd2] = spawn.mock.calls[1] as [string, string];
        expect(name1).toMatch(/^Superset: Install pm2 \(\d{2}:\d{2}:\d{2}\)$/);
        expect(name2).toMatch(/^Superset: Install skills \(\d{2}:\d{2}:\d{2}\)$/);
        expect(cwd1).toBe(os.homedir());
        expect(cwd2).toBe(os.homedir());

        // Each terminal had show() called and got a single
        // `go install ... && exit` line.
        const sent1 = (t1 as { sendText: ReturnType<typeof vi.fn> })
            .sendText.mock.calls[0][0] as string;
        const sent2 = (t2 as { sendText: ReturnType<typeof vi.fn> })
            .sendText.mock.calls[0][0] as string;
        expect(sent1).toBe(
            "go install github.com/bizshuk/pm2@master && exit\r"
        );
        expect(sent2).toBe(
            "go install github.com/bizshuk/skills@master && exit\r"
        );

        // No manual dispose from the extension — auto-close is
        // driven by the PTY host's onExit handler when the shell
        // exits. The extension just sends the cmdline.
        expect((t1 as { dispose: ReturnType<typeof vi.fn> }).dispose).not.toHaveBeenCalled();
        expect((t2 as { dispose: ReturnType<typeof vi.fn> }).dispose).not.toHaveBeenCalled();

        // Most importantly: vscode.window.createTerminal was NOT
        // called. A plain terminal would be disposed 150ms later by
        // the auto-PTY layer.
        expect(
            (vscode.window as unknown as { createTerminal: ReturnType<typeof vi.fn> })
                .createTerminal
        ).not.toHaveBeenCalled();
    });

    it("installDefaultTools shows a non-throwing error when the spawner is unset", async () => {
        setTerminalSpawner(undefined);
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        const pCtx = fakePluginContext();
        globalCommandsPlugin.activate(pCtx as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.installDefaultTools")!;
        await expect(cb()).resolves.toBeUndefined();

        const showError = (vscode.window as unknown as {
            showErrorMessage: ReturnType<typeof vi.fn>;
        }).showErrorMessage;
        expect(showError).toHaveBeenCalledTimes(1);
        expect(showError.mock.calls[0][0]).toMatch(/Terminals 模組尚未啟用/);
    });

    it("skillInstall pre-fills the input box with the resolved default and uses the spawner on Enter", async () => {
        // Simulate the user pressing Enter without editing the
        // prefilled value.
        (
            (vscode.window as unknown as {
                showInputBox: ReturnType<typeof vi.fn>;
            }).showInputBox as ReturnType<typeof vi.fn>
        ).mockResolvedValueOnce("bizshuk/custom-skill");

        const t = {
            name: "Superset: Skill Install (bizshuk/custom-skill)",
            show: vi.fn(),
            sendText: vi.fn(),
            dispose: vi.fn(),
        } as unknown as vscode.Terminal;
        const spawn = vi.fn().mockReturnValue(t);
        setTerminalSpawner(spawn);
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        const pCtx = fakePluginContext();
        globalCommandsPlugin.activate(pCtx as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.skillInstall")!;
        await cb({ repo: "bizshuk/custom-skill" });

        // InputBox was shown with the resolved repo pre-filled as
        // `value` (and fully selected so a single keystroke replaces
        // it). The spawner is driven only after the user confirms
        // by pressing Enter (returning the string).
        const showInput = (vscode.window as unknown as {
            showInputBox: ReturnType<typeof vi.fn>;
        }).showInputBox;
        expect(showInput).toHaveBeenCalledTimes(1);
        const inputOpts = showInput.mock.calls[0][0] as {
            value: string;
            valueSelection: [number, number];
            placeHolder?: string;
        };
        expect(inputOpts.value).toBe("bizshuk/custom-skill");
        expect(inputOpts.valueSelection).toEqual([0, "bizshuk/custom-skill".length]);

        // No modal: showInformationMessage should NOT have been
        // called for skillInstall anymore.
        const showInfo = (vscode.window as unknown as {
            showInformationMessage: ReturnType<typeof vi.fn>;
        }).showInformationMessage;
        expect(showInfo).not.toHaveBeenCalled();

        // Spawner was used with the timestamped name; the cmdline
        // is `skills add ... && exit` so the shell self-closes on
        // success.
        expect(spawn).toHaveBeenCalledTimes(1);
        expect((t as { show: ReturnType<typeof vi.fn> }).show).toHaveBeenCalledWith(true);
        expect((t as { sendText: ReturnType<typeof vi.fn> }).sendText).toHaveBeenCalledTimes(1);
        const sent = (t as { sendText: ReturnType<typeof vi.fn> })
            .sendText.mock.calls[0][0] as string;
        expect(sent).toBe("skills add bizshuk/custom-skill && exit\r");
    });

    it("skillInstall honours a user-typed override in the input box", async () => {
        // User pre-filled with default `bizshuk/cc-plugin` but
        // edited it to `acme/widget` before pressing Enter. The
        // command must use the typed value, not the default.
        (
            (vscode.window as unknown as {
                showInputBox: ReturnType<typeof vi.fn>;
            }).showInputBox as ReturnType<typeof vi.fn>
        ).mockResolvedValueOnce("acme/widget");

        const t = {
            name: "Superset: Skill Install (acme/widget)",
            show: vi.fn(),
            sendText: vi.fn(),
            dispose: vi.fn(),
        } as unknown as vscode.Terminal;
        const spawn = vi.fn().mockReturnValue(t);
        setTerminalSpawner(spawn);
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        const pCtx = fakePluginContext();
        globalCommandsPlugin.activate(pCtx as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.skillInstall")!;
        await cb(); // no args → default bizshuk/cc-plugin

        const sent = (t as { sendText: ReturnType<typeof vi.fn> })
            .sendText.mock.calls[0][0] as string;
        expect(sent).toBe("skills add acme/widget && exit\r");
    });

    it("skillInstall falls back to the default when the user clears the input and presses Enter", async () => {
        // Simulates: pre-filled with `bizshuk/cc-plugin`, user
        // selects all + deletes, presses Enter on the empty field.
        // The contract says empty input is not a meaningful repo,
        // so we treat it as "accept the default".
        (
            (vscode.window as unknown as {
                showInputBox: ReturnType<typeof vi.fn>;
            }).showInputBox as ReturnType<typeof vi.fn>
        ).mockResolvedValueOnce("");

        const t = {
            name: "Superset: Skill Install (bizshuk/cc-plugin)",
            show: vi.fn(),
            sendText: vi.fn(),
            dispose: vi.fn(),
        } as unknown as vscode.Terminal;
        const spawn = vi.fn().mockReturnValue(t);
        setTerminalSpawner(spawn);
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        const pCtx = fakePluginContext();
        globalCommandsPlugin.activate(pCtx as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.skillInstall")!;
        await cb(); // no args → default bizshuk/cc-plugin

        const sent = (t as { sendText: ReturnType<typeof vi.fn> })
            .sendText.mock.calls[0][0] as string;
        expect(sent).toBe("skills add bizshuk/cc-plugin && exit\r");
    });

    it("skillInstall cancels when the user presses Esc on the input box", async () => {
        // Esc / dialog dismiss → showInputBox resolves to undefined.
        (
            (vscode.window as unknown as {
                showInputBox: ReturnType<typeof vi.fn>;
            }).showInputBox as ReturnType<typeof vi.fn>
        ).mockResolvedValueOnce(undefined);

        setTerminalSpawner(undefined);
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        const pCtx = fakePluginContext();

        const spawn = vi.fn();
        setTerminalSpawner(spawn);
        globalCommandsPlugin.activate(pCtx as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.skillInstall")!;
        await cb({ repo: "bizshuk/never-installed" });

        // User dismissed the dialog → no terminal was spawned.
        expect(spawn).not.toHaveBeenCalled();
    });
});
