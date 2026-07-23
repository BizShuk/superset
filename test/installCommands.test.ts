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

// Mock node:fs so installLicense can assert writeFile paths
// without touching the real filesystem. We delegate everything
// else through `vi.importActual` so the helpers below (e.g.
// `path.join`) still resolve normally. Other install commands in
// this file don't touch fs so this mock is transparent to them.
vi.mock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    return {
        ...actual,
        existsSync: vi.fn(() => false),
        promises: {
            ...actual.promises,
            writeFile: vi.fn(async () => {}),
        },
    };
});

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
import * as path from "path";
import * as fs from "node:fs";
import { globalCommandsPlugin } from "../src/globalCommandsPlugin";
import {
    setDiagnosticChannel,
    setPluginManager,
    setTerminalSpawner,
    getTerminalSpawner,
} from "../src/crossModuleState";

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
        asMock(vscode.window.createTerminal).mockClear();
        asMock(vscode.window.showInformationMessage).mockClear();
        asMock(vscode.window.showErrorMessage).mockClear();
        // Reset picker mocks too: per-test `mockResolvedValueOnce(...)`
        // values must not leak into the next command test.
        asMock(vscode.window.showInputBox).mockReset();
        asMock(vscode.window.showInputBox).mockResolvedValue(undefined);
        asMock(vscode.window.showQuickPick).mockReset();
        asMock(vscode.window.showQuickPick).mockResolvedValue(undefined);
    });

    it("setTerminalSpawner / getTerminalSpawner round-trip", () => {
        const fake = vi.fn();
        setTerminalSpawner(fake);
        expect(getTerminalSpawner()).toBe(fake);
        setTerminalSpawner(undefined);
        expect(getTerminalSpawner()).toBeUndefined();
    });

    it("installDefaultTools spawns five separate terminals (one per go install), each cmdline suffixed with `&& exit`, and does NOT call createTerminal", async () => {
        const expectedTools = [
            {
                label: "pm2",
                cmd: "go install github.com/bizshuk/pm2@master",
            },
            {
                label: "skills",
                cmd: "go install github.com/bizshuk/skills@master",
            },
            {
                label: "dux",
                cmd: "go install github.com/bizshuk/dux@master",
            },
            {
                label: "port",
                cmd: "go install github.com/bizshuk/port@master",
            },
            {
                label: "sessiond",
                cmd: "go install github.com/bizshuk/sessiond@master",
            },
        ];
        const makeTerminal = () =>
            ({
                name: "a",
                show: vi.fn(),
                sendText: vi.fn(),
                dispose: vi.fn(),
            }) as unknown as vscode.Terminal;
        const terminals = expectedTools.map(() => makeTerminal());
        const spawn = vi.fn()
            .mockReturnValueOnce(terminals[0])
            .mockReturnValueOnce(terminals[1])
            .mockReturnValueOnce(terminals[2])
            .mockReturnValueOnce(terminals[3])
            .mockReturnValueOnce(terminals[4]);
        setTerminalSpawner(spawn);
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        const pCtx = fakePluginContext();
        globalCommandsPlugin.activate(pCtx as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.installDefaultTools")!;
        await cb();

        // Each default tool gets its own terminal, preserving the install
        // order so the user can watch or abort them independently.
        expect(spawn).toHaveBeenCalledTimes(expectedTools.length);
        expectedTools.forEach((tool, index) => {
            const [name, cwd] = spawn.mock.calls[index] as [string, string];
            expect(name).toMatch(
                new RegExp(
                    `^Superset: Install ${tool.label} \\(\\d{2}:\\d{2}:\\d{2}\\)$`
                )
            );
            expect(cwd).toBe(os.homedir());

            const sent = (terminals[index] as { sendText: ReturnType<typeof vi.fn> })
                .sendText.mock.calls[0][0] as string;
            expect(sent).toBe(`${tool.cmd} && exit\r`);
        });

        // No manual dispose from the extension — auto-close is
        // driven by the PTY host's onExit handler when the shell
        // exits. The extension just sends the cmdline.
        terminals.forEach((terminal) => {
            expect(
                (terminal as { dispose: ReturnType<typeof vi.fn> }).dispose
            ).not.toHaveBeenCalled();
        });

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

    it("projectsSetup runs the bundled setup script against the fixed ~/projects root", async () => {
        const terminal = {
            name: "projects setup",
            show: vi.fn(),
            sendText: vi.fn(),
            dispose: vi.fn(),
        } as unknown as vscode.Terminal;
        const spawn = vi.fn().mockReturnValue(terminal);
        setTerminalSpawner(spawn);
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        globalCommandsPlugin.activate(fakePluginContext() as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.projectsSetup")!;
        await cb();

        expect(spawn).toHaveBeenCalledTimes(1);
        const [name, cwd] = spawn.mock.calls[0] as [string, string];
        expect(name).toMatch(
            /^Superset: Projects Setup \(\d{2}:\d{2}:\d{2}\)$/
        );
        expect(cwd).toBe(os.homedir());

        const sent = (
            terminal as { sendText: ReturnType<typeof vi.fn> }
        ).sendText.mock.calls[0][0] as string;
        expect(sent).toBe(
            `'bash' '/fake/pkg/resources/config/setup-projects.sh' '${path.join(
                os.homedir(),
                "projects"
            )}' && exit\r`
        );
        expect(vscode.window.showInputBox).not.toHaveBeenCalled();
        expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it("skillInstall describes every repository and installs the default pick", async () => {
        asMock(vscode.window.showQuickPick).mockResolvedValueOnce({
            label: "bizshuk/cc-plugin",
            description:
                "預設 · AI 編碼代理的全域設定、Skills、Agents 與記憶工具",
            detail: "GitHub · bizshuk/cc-plugin",
            repo: "bizshuk/cc-plugin",
        });

        const t = {
            name: "Superset: Install Skills (bizshuk/cc-plugin)",
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
        await cb();

        const showQuickPick = asMock(vscode.window.showQuickPick);
        expect(showQuickPick).toHaveBeenCalledTimes(1);
        const pickItems = showQuickPick.mock.calls[0][0] as Array<{
            label: string;
            description?: string;
            detail?: string;
            repo: string;
        }>;
        expect(pickItems).toEqual([
            {
                label: "bizshuk/cc-plugin",
                description:
                    "預設 · AI 編碼代理的全域設定、Skills、Agents 與記憶工具",
                detail: "GitHub · bizshuk/cc-plugin",
                repo: "bizshuk/cc-plugin",
            },
            {
                label: "anthropics/claude-plugins-official",
                description:
                    "Anthropic 維護的 Claude Code 高品質 Plugin 目錄",
                detail: "GitHub · anthropics/claude-plugins-official",
                repo: "anthropics/claude-plugins-official",
            },
            {
                label: "anthropics/skills",
                description:
                    "Anthropic 的 Agent Skills 範例、規格與文件處理技能",
                detail: "GitHub · anthropics/skills",
                repo: "anthropics/skills",
            },
            {
                label: "awesome-claude-code-subagents",
                description:
                    "涵蓋多種開發任務的 Claude Code 專用 Subagents 合集",
                detail:
                    "GitHub · VoltAgent/awesome-claude-code-subagents",
                repo: "VoltAgent/awesome-claude-code-subagents",
            },
            {
                label: "superpowers",
                description:
                    "以 Skills 驅動規劃、TDD、除錯與協作的開發方法",
                detail: "GitHub · obra/superpowers",
                repo: "obra/superpowers",
            },
            {
                label: "understand-anything",
                description:
                    "把程式碼與文件轉成可搜尋、可提問的互動知識圖譜",
                detail: "GitHub · Egonex-AI/Understand-Anything",
                repo: "Egonex-AI/Understand-Anything",
            },
            {
                label: "last30days",
                description:
                    "彙整近 30 天社群與網路討論，產出有來源的研究摘要",
                detail: "GitHub · mvanhorn/last30days-skill",
                repo: "mvanhorn/last30days-skill",
            },
            {
                label: "ui-ux-pro-max-skill",
                description:
                    "為多平台 UI/UX 產生設計系統、樣式與實作建議",
                detail:
                    "GitHub · nextlevelbuilder/ui-ux-pro-max-skill",
                repo: "nextlevelbuilder/ui-ux-pro-max-skill",
            },
        ]);
        expect(showQuickPick.mock.calls[0][1]).toMatchObject({
            title: "Superset: Install Skills",
            placeHolder: "選擇要安裝的 skill repository",
            matchOnDescription: true,
            matchOnDetail: true,
        });
        expect(vscode.window.showInputBox).not.toHaveBeenCalled();

        expect(spawn).toHaveBeenCalledTimes(1);
        expect(spawn.mock.calls[0][0]).toMatch(
            /^Superset: Install Skills \(bizshuk\/cc-plugin\) \(\d{2}:\d{2}:\d{2}\)$/
        );
        expect((t as { show: ReturnType<typeof vi.fn> }).show).toHaveBeenCalledWith(true);
        const sent = (t as { sendText: ReturnType<typeof vi.fn> })
            .sendText.mock.calls[0][0] as string;
        expect(sent).toBe("skills add bizshuk/cc-plugin && exit\r");
    });

    it("skillInstall installs the selected Anthropic repository", async () => {
        asMock(vscode.window.showQuickPick).mockResolvedValueOnce({
            label: "anthropics/skills",
            repo: "anthropics/skills",
        });

        const t = {
            name: "Superset: Install Skills (anthropics/skills)",
            show: vi.fn(),
            sendText: vi.fn(),
            dispose: vi.fn(),
        } as unknown as vscode.Terminal;
        setTerminalSpawner(vi.fn().mockReturnValue(t));
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        globalCommandsPlugin.activate(fakePluginContext() as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.skillInstall")!;
        await cb();

        const sent = (t as { sendText: ReturnType<typeof vi.fn> })
            .sendText.mock.calls[0][0] as string;
        expect(sent).toBe("skills add anthropics/skills && exit\r");
    });

    it("skillInstall uses a programmatic repo argument without showing the dropdown", async () => {
        const t = {
            name: "Superset: Install Skills (bizshuk/custom-skill)",
            show: vi.fn(),
            sendText: vi.fn(),
            dispose: vi.fn(),
        } as unknown as vscode.Terminal;
        setTerminalSpawner(vi.fn().mockReturnValue(t));
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        globalCommandsPlugin.activate(fakePluginContext() as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.skillInstall")!;
        await cb({ repo: "  bizshuk/custom-skill  " });

        expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
        const sent = (t as { sendText: ReturnType<typeof vi.fn> })
            .sendText.mock.calls[0][0] as string;
        expect(sent).toBe("skills add bizshuk/custom-skill && exit\r");
    });

    it("skillInstall cancels when the user dismisses the dropdown", async () => {
        asMock(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);

        const spawn = vi.fn();
        setTerminalSpawner(spawn);
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        globalCommandsPlugin.activate(fakePluginContext() as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.skillInstall")!;
        await cb();

        expect(spawn).not.toHaveBeenCalled();
    });

    it("installDefaultProject spawns the terminal in ctx.workspaceFolder (NOT home) so .gitignore lands in the workspace", async () => {
        // Regression: install-default-project.sh writes `.gitignore` /
        // `.geminiignore` / `.claudeignore` relative to CWD.
        // Before the fix, spawnRunTerminal always used
        // `os.homedir()` — so the files silently landed in `~/`
        // instead of the workspace, AND the overwrite-confirmation
        // modal was checking the wrong location entirely.

        // fs.existsSync is mocked at file scope to always return
        // false (no files exist in the fake workspace), so the
        // overwrite-warning branch is skipped.

        const t = {
            name: "ignore",
            show: vi.fn(),
            sendText: vi.fn(),
            dispose: vi.fn(),
        } as unknown as vscode.Terminal;
        const spawn = vi.fn().mockReturnValue(t);
        setTerminalSpawner(spawn);
        setDiagnosticChannel(vscode.window.createOutputChannel("test"));
        setPluginManager(undefined);
        const pCtx = fakePluginContext(); // workspaceFolder = "/ws"
        globalCommandsPlugin.activate(pCtx as never);

        const cb = (
            vscode as unknown as { __commands: Map<string, Function> }
        ).__commands.get("superset.installDefaultProject")!;
        // Programmatic call — bypasses command palette, but still
        // hits the same handler.
        await cb();

        expect(spawn).toHaveBeenCalledTimes(1);
        const [name, cwd] = spawn.mock.calls[0] as [string, string];
        expect(name).toMatch(
            /^Superset: Install Default Project \(\d{2}:\d{2}:\d{2}\)$/
        );
        // Critical assertion: cwd MUST be the workspace folder,
        // never the user's home. This is the bug we're guarding.
        expect(cwd).toBe("/ws");
        expect(cwd).not.toBe(os.homedir());

        // The command line should quote the absolute script path
        // (resolved from the extension's install root) and pass all
        // three default targets, plus `&& exit` from
        // `closeOnSuccess: true`. No `--force` because nothing
        // existed when we checked. Every argv element (including
        // `bash`) goes through `quoteShellArg`, hence the `'...'` wrapping.
        const sent = (
            t as { sendText: ReturnType<typeof vi.fn> }
        ).sendText.mock.calls[0][0] as string;
        expect(sent).toBe(
            "'bash' '/fake/pkg/resources/config/install-default-project.sh' 'git' 'gemini' 'claude' && exit\r"
        );

        // Manual dispose must not happen — auto-PTY close is
        // driven by the `&& exit` self-termination.
        expect(
            (t as { dispose: ReturnType<typeof vi.fn> }).dispose
        ).not.toHaveBeenCalled();
    });

    it("installDefaultProject forwards `args.targets` to the script verbatim", async () => {
        // Verify a partial-target invocation (e.g. wired from a
        // future TreeView menu) hits the bash script with only
        // those targets.
        const t = {
            name: "ignore",
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
        ).__commands.get("superset.installDefaultProject")!;
        await cb({ targets: ["git"] });

        expect(spawn).toHaveBeenCalledTimes(1);
        const [, cwd] = spawn.mock.calls[0] as [string, string];
        expect(cwd).toBe("/ws");
        const sent = (
            t as { sendText: ReturnType<typeof vi.fn> }
        ).sendText.mock.calls[0][0] as string;
        // Only `git` target — no `gemini` / `claude`. `args.targets`
        // is forwarded verbatim to the bash script (the script
        // itself handles per-target iteration).
        expect(sent).toBe(
            "'bash' '/fake/pkg/resources/config/install-default-project.sh' 'git' && exit\r"
        );
        expect(sent).not.toMatch(/gemini/);
        expect(sent).not.toMatch(/claude/);
        // No `--force` flag — fs.existsSync returns false in the
        // shared mock, so the confirmation modal is not triggered.
        expect(sent).not.toMatch(/--force/);
    });
});

// Source-level contract check avoids running an installer that writes files.
describe("default project installer contract", () => {
    it("keeps target mappings and default target order aligned with the shell installer", () => {
        const installCommands = fs.readFileSync(
            path.join(__dirname, "..", "src", "installCommands.ts"),
            "utf8"
        );
        const installer = fs.readFileSync(
            path.join(
                __dirname,
                "..",
                "pkg",
                "resources",
                "config",
                "install-default-project.sh"
            ),
            "utf8"
        );

        const typescriptMappings = Object.fromEntries(
            [...installCommands.matchAll(/^    ([a-z]+): "([^\"]+)",$/gm)].map(
                ([, target, output]) => [target, output]
            )
        );
        const shellMappings = Object.fromEntries(
            [...installer.matchAll(/^    ([a-z]+)\)\s+out=([^\s]+)\s*;;$/gm)].map(
                ([, target, output]) => [target, output]
            )
        );
        expect(typescriptMappings).toEqual(shellMappings);

        const typescriptDefaults = installCommands.match(
            /args\?\.targets \?\? \[([^\]]+)\]/
        )?.[1]
            .split(",")
            .map((target) => target.trim().replace(/^['\"]|['\"]$/g, ""));
        const shellDefaults = installer.match(/TARGETS=\(([^)]+)\)/)?.[1].split(/\s+/);
        expect(typescriptDefaults).toEqual(shellDefaults);
    });
});

// ---------------------------------------------------------------------------
// installLicense — QuickPick + LICENSE write + overwrite-confirmation flow.
// ---------------------------------------------------------------------------

// Cast helper — same trick used elsewhere in this file. Avoids
// `as unknown as` casts at every call site.
function asMock<T>(fn: T): ReturnType<typeof vi.fn> {
    return fn as unknown as ReturnType<typeof vi.fn>;
}

async function activateLicensePlugin(): Promise<void> {
    setDiagnosticChannel(vscode.window.createOutputChannel("test"));
    setPluginManager(undefined);
    const pCtx = fakePluginContext();
    globalCommandsPlugin.activate(pCtx as never);
}

function getLicenseCallback(): (args?: unknown) => Promise<void> {
    return (
        vscode as unknown as {
            __commands: Map<string, (...a: unknown[]) => unknown>;
        }
    ).__commands.get("superset.installLicense") as (
        args?: unknown
    ) => Promise<void>;
}

describe("installLicense", () => {
    let existsSyncMock: ReturnType<typeof vi.fn>;
    let writeFileMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        (
            vscode as unknown as { __commands: Map<string, unknown> }
        ).__commands.clear();
        asMock(vscode.window.showQuickPick).mockReset();
        asMock(vscode.window.showWarningMessage).mockReset();
        asMock(vscode.window.showInformationMessage).mockReset();

        existsSyncMock = fs.existsSync as unknown as ReturnType<typeof vi.fn>;
        writeFileMock = (
            fs.promises as unknown as { writeFile: ReturnType<typeof vi.fn> }
        ).writeFile;
        existsSyncMock.mockReset();
        writeFileMock.mockReset();
        // Default: no LICENSE in the workspace, no throw.
        existsSyncMock.mockReturnValue(false);
        writeFileMock.mockResolvedValue(undefined);
    });

    it("shows the QuickPick with all three license templates and writes the picked one to <workspaceFolder>/LICENSE", async () => {
        // User selects MIT (index 1) from the QuickPick.
        const pickedItem = {
            label: "MIT License",
            description: "Short permissive; widely used, minimal restriction",
            // The handler reads `picked.license.id`, so we mirror the
            // shape of `LicensePickItem` produced by the command.
            license: { id: "MIT", label: "MIT License" },
        };
        asMock(vscode.window.showQuickPick).mockResolvedValueOnce(pickedItem);

        await activateLicensePlugin();
        await getLicenseCallback()();

        // QuickPick was offered the three templates; the order in the
        // production code matches LICENSE_TEMPLATES.
        const showQuickPick = asMock(vscode.window.showQuickPick);
        expect(showQuickPick).toHaveBeenCalledTimes(1);
        const pickItems = showQuickPick.mock.calls[0][0] as Array<{
            label: string;
            description: string;
            license: { id: string; label: string };
        }>;
        expect(pickItems.map((p) => p.license.id)).toEqual([
            "Apache-2.0",
            "MIT",
            "BSD-3-Clause",
        ]);
        expect(pickItems.map((p) => p.label)).toEqual([
            "Apache License 2.0",
            "MIT License",
            "BSD 3-Clause License",
        ]);

        // fs.writeFile was called with the MIT body (no pre-existing
        // file → no overwrite confirmation modal). The path is
        // <workspaceFolder>/LICENSE and the text starts with the MIT
        // banner + copyright line for the current year.
        expect(writeFileMock).toHaveBeenCalledTimes(1);
        const [calledPath, calledText, calledEncoding] = writeFileMock.mock
            .calls[0] as [string, string, string];
        expect(calledPath).toBe(path.join("/ws", "LICENSE"));
        expect(calledEncoding).toBe("utf8");
        expect(calledText).toMatch(/^MIT License\n\nCopyright \(c\) \d{4} /);
        expect(calledText).toMatch(
            /Permission is hereby granted, free of charge/
        );

        // Success toast was shown.
        expect(asMock(vscode.window.showInformationMessage)).toHaveBeenCalledTimes(
            1
        );
        expect(
            asMock(vscode.window.showInformationMessage).mock.calls[0][0]
        ).toMatch(/已安裝 MIT License 至 .*\/LICENSE/);
    });

    it("prompts for confirmation when LICENSE already exists and cancels if the user picks Cancel", async () => {
        existsSyncMock.mockReturnValue(true);
        // QuickPick still runs first (user picks MIT), then the
        // overwrite modal pops up.
        asMock(vscode.window.showQuickPick).mockResolvedValueOnce({
            label: "MIT License",
            description: "Short permissive; widely used, minimal restriction",
            license: { id: "MIT", label: "MIT License" },
        });
        // User picks Cancel on the overwrite modal.
        asMock(vscode.window.showWarningMessage).mockResolvedValueOnce("Cancel");

        await activateLicensePlugin();
        await getLicenseCallback()();

        // Warning was shown with a modal-flag dialog mentioning LICENSE.
        const warn = asMock(vscode.window.showWarningMessage);
        expect(warn).toHaveBeenCalledTimes(1);
        const [warnMsg, warnOpts] = warn.mock.calls[0] as [string, unknown];
        expect(warnMsg).toMatch(/LICENSE 已存在/);
        expect(warnOpts).toEqual({ modal: true });

        // Because the user picked Cancel, no file was written and no
        // success toast appeared.
        expect(writeFileMock).not.toHaveBeenCalled();
        expect(
            asMock(vscode.window.showInformationMessage)
        ).not.toHaveBeenCalled();
    });

    it("overwrites the existing LICENSE when the user picks Overwrite on the confirmation modal", async () => {
        existsSyncMock.mockReturnValue(true);
        asMock(vscode.window.showQuickPick).mockResolvedValueOnce({
            label: "BSD 3-Clause License",
            description: "Permissive + non-endorsement clause",
            license: { id: "BSD-3-Clause", label: "BSD 3-Clause License" },
        });
        asMock(vscode.window.showWarningMessage).mockResolvedValueOnce(
            "Overwrite"
        );

        await activateLicensePlugin();
        await getLicenseCallback()();

        // The confirmation ran, the user accepted, and the BSD-3 file
        // was written.
        expect(writeFileMock).toHaveBeenCalledTimes(1);
        const [, calledText] = writeFileMock.mock.calls[0] as [string, string];
        expect(calledText).toMatch(/^BSD 3-Clause License\n\nCopyright \(c\) \d{4}/);
        expect(calledText).toMatch(/Neither the name of the copyright holder/);
    });

    it("skips the QuickPick when licenseId is passed as an arg and writes the requested license", async () => {
        // Programmatic caller (e.g. a future TreeView menu) bypasses
        // the dialog. `force: true` skips the overwrite modal too so
        // we can assert the write in isolation.
        existsSyncMock.mockReturnValue(true);
        await activateLicensePlugin();
        await getLicenseCallback()({
            licenseId: "Apache-2.0",
            force: true,
        });

        // No QuickPick and no overwrite warning.
        expect(asMock(vscode.window.showQuickPick)).not.toHaveBeenCalled();
        expect(asMock(vscode.window.showWarningMessage)).not.toHaveBeenCalled();

        expect(writeFileMock).toHaveBeenCalledTimes(1);
        const [, calledText] = writeFileMock.mock.calls[0] as [string, string];
        // Apache body has its own banner; the year placeholder is
        // resolved at write-time from `new Date().getFullYear()`.
        expect(calledText).toMatch(/Apache License\n\s+Version 2\.0/);
        expect(calledText).toMatch(
            new RegExp(`Copyright ${new Date().getFullYear()} \\[name of copyright owner\\]`)
        );
    });

    it("populates each QuickPick item's detail field with the license summary so the user can compare options before picking", async () => {
        // No user pick needed for this assertion — we only care about
        // the items offered to showQuickPick, not the result.
        asMock(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);

        await activateLicensePlugin();
        await getLicenseCallback()();

        const showQuickPick = asMock(vscode.window.showQuickPick);
        expect(showQuickPick).toHaveBeenCalledTimes(1);
        const pickItems = showQuickPick.mock.calls[0][0] as Array<{
            license: { id: string };
            detail?: string;
        }>;

        // Every item must carry a non-empty detail that mentions
        // Permissions / Conditions / Limitations — that's the
        // tradeoff lens the user reads while arrowing through.
        expect(pickItems).toHaveLength(3);
        for (const item of pickItems) {
            expect(item.detail, `${item.license.id} missing detail`).toBeTruthy();
            expect(item.detail).toMatch(/Permissions/);
            expect(item.detail).toMatch(/Conditions/);
            expect(item.detail).toMatch(/Limitations/);
        }

        // BSD-3-Clause's non-endorsement clause is its distinguishing
        // condition; lock that down so a future template edit can't
        // silently drop it.
        const bsd = pickItems.find((p) => p.license.id === "BSD-3-Clause");
        expect(bsd?.detail).toMatch(/non-endorsement/);
    });
});
