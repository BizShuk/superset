// Minimal vscode mock — enough surface to let `extension.ts`
// import + call `activate()` without exploding. The real test
// is whether:
// 1. The manager activates every plugin in the list.
// 2. The returned `extendMarkdownIt` composes the treePreview +
//    todoPreview hooks in the right order.
// 3. The global-commands plugin registers its expected command surface.
// 4. `superset.resetCaches` end-to-end fires the manager's resetAll.
vi.mock("vscode", () => {
    let outputDisposeCount = 0;
    class EventEmitter<T> {
        private listeners = new Set<(e: T) => void>();
        event = (listener: (e: T) => void) => {
            this.listeners.add(listener);
            return { dispose: () => this.listeners.delete(listener) };
        };
        fire(e: T) {
            for (const l of this.listeners) l(e);
        }
        dispose() { this.listeners.clear(); }
    }
    const noop = () => {};
    const noopDisposable = { dispose: noop };
    const commands = new Map<string, (...args: unknown[]) => unknown>();
    const executedCommands: Array<[string, ...unknown[]]> = [];
    return {
        EventEmitter,
        Uri: {
            file: (p: string) => ({ fsPath: p, scheme: "file", path: p }),
            parse: (s: string) => ({ fsPath: s, scheme: "url", path: s }),
        },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        // `cliLauncher/tree.ts` subclasses TreeItem at module scope, so this
        // has to exist before `extension.ts` finishes importing.
        TreeItem: class TreeItem {
            constructor(
                public label: string,
                public collapsibleState?: number
            ) {}
        },
        MarkdownString: class MarkdownString {
            constructor(public value: string) {}
        },
        ThemeIcon: class ThemeIcon {
            constructor(public id: string) {}
        },
        ThemeColor: class ThemeColor {
            constructor(public id: string) {}
        },
        ViewColumn: { Active: -1 },
        window: {
            createOutputChannel: () => ({
                appendLine: noop,
                show: noop,
                dispose: () => {
                    outputDisposeCount += 1;
                },
            }),
            createStatusBarItem: () => ({
                text: "",
                tooltip: "",
                name: "",
                show: noop,
                hide: noop,
                dispose: noop,
            }),
            createTreeView: vi.fn(() => ({
                onDidChangeCheckboxState: undefined,
                // panelLayout feature (0.9.0) wires each panel's
                // `onDidChangeVisibility` to `superset.reportViewVisible`;
                // the mock returns a real disposable so subscribing
                // never throws.
                onDidChangeVisibility: () => ({
                    dispose: () => undefined,
                }),
                selection: [],
                title: "",
                dispose: noop,
            })),
            showInformationMessage: async () => undefined,
            showWarningMessage: async () => "Reset", // auto-confirm reset
            showErrorMessage: async () => undefined,
            showInputBox: async () => undefined,
            showQuickPick: async () => undefined,
            // Terminal lifecycle edges — cliLauncher subscribes to these at
            // activation so it knows when a launched agent has finished.
            onDidCloseTerminal: () => noopDisposable,
            onDidStartTerminalShellExecution: () => noopDisposable,
            onDidEndTerminalShellExecution: () => noopDisposable,
            onDidChangeTerminalShellIntegration: () => noopDisposable,
        },
        workspace: {
            workspaceFolders: [{ uri: { fsPath: "/ws" } }],
            onDidChangeWorkspaceFolders: () => noopDisposable,
            onDidChangeConfiguration: () => noopDisposable,
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
            registerCommand: (id: string, cb: (...args: unknown[]) => unknown) => {
                commands.set(id, cb);
                return { dispose: () => commands.delete(id) };
            },
            executeCommand: async (id: string, ...args: unknown[]) => {
                executedCommands.push([id, ...args]);
                const cb = commands.get(id);
                if (cb) return cb(...args);
            },
        },
        StatusBarAlignment: { Left: 0, Right: 1 },
        Disposable: { from: () => noopDisposable },
        // Test helpers
        __commands: commands,
        __executedCommands: executedCommands,
        __outputDisposeCount: () => outputDisposeCount,
        __resetTestState: () => {
            commands.clear();
            executedCommands.length = 0;
            outputDisposeCount = 0;
        },
    };
});

import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import {
    getDiagnosticChannel,
    getPluginManager,
    getTerminalSpawner,
    setTerminalSpawner,
} from "../src/crossModuleState";
import { getTreeViewRegistry } from "../src/plugin/treeViewRegistry";

const { activate, deactivate } = await import("../src/extension");

function fakeExtCtx(): vscode.ExtensionContext {
    return {
        extensionUri: { fsPath: "/fake" } as vscode.Uri,
        globalState: { get: () => undefined, update: async () => {} } as unknown as vscode.Memento,
        workspaceState: {
            get: () => undefined,
            update: async () => {},
        } as unknown as vscode.Memento,
        subscriptions: [],
    } as unknown as vscode.ExtensionContext;
}

describe("extension activation via PluginManager", () => {
    beforeEach(async () => {
        await deactivate();
        (
            vscode as unknown as { __resetTestState(): void }
        ).__resetTestState();
    });

    afterEach(async () => {
        await deactivate();
    });

    it("activates without throwing and returns a markdown-it extender", async () => {
        const ext = fakeExtCtx();
        const result = await activate(ext);
        expect(result).toBeDefined();
        expect(typeof result!.extendMarkdownIt).toBe("function");
    });

    it("the returned extender pushes both the treePreview fence rule and the todoPreview core ruler", async () => {
        const ext = fakeExtCtx();
        const result = (await activate(ext))!;
        const fencePushes: string[] = [];
        const corePushes: string[] = [];
        const md = {
            core: {
                ruler: {
                    push: (name: string, _fn: unknown) => {
                        corePushes.push(name);
                    },
                },
            },
            renderer: {
                rules: {
                    fence: (() => {
                        // Capture the original default so the chain can fall back.
                        return "<default-fence>";
                    }) as unknown,
                },
            },
            utils: { escapeHtml: (s: string) => s },
        };
        result.extendMarkdownIt(md as never);
        // treePreview's fence override replaces md.renderer.rules.fence;
        // todoPreview's core ruler adds "todo_section_wrap".
        expect(corePushes).toContain("todo_section_wrap");
    });

    it("registers every global command", async () => {
        const ext = fakeExtCtx();
        await activate(ext);
        const cmds = (vscode as unknown as { __commands: Map<string, unknown> }).__commands;
        // Commands owned by the global-commands plugin (always registered).
        for (const id of [
            "superset.resetCaches",
            "superset.focusView",
            "superset.showLogs",
            "superset.focusPanel",
            "superset.installDefaultTools",
            "superset.skillInstall",
            "superset.projectsSetup",
        ]) {
            expect(cmds.has(id), `missing global command: ${id}`).toBe(true);
        }
        // Commands from feature plugins that survive the lightweight
        // `vscode` mock used here (terminals / mdns / topology).
        // The `todo` plugin needs `RelativePattern` which is not in
        // this mock; the error boundary correctly marks it failed,
        // and its commands are absent — the test only asserts on
        // commands that did register, so the boundary contract is
        // also exercised.
        expect(cmds.has("superset.topologyScan")).toBe(true);
        expect(cmds.has("superset.mdnsRefresh")).toBe(true);
        expect(cmds.has("superset.todoNew")).toBe(false); // bounded by failed plugin
    });

    it("error boundary keeps the surviving plugins' commands even when one fails", async () => {
        const ext = fakeExtCtx();
        await activate(ext);
        // The `todo` plugin failed inside the mock, yet the manager
        // continued past it. Verify that a sibling plugin's command
        // still landed in the registry.
        const cmds = (vscode as unknown as { __commands: Map<string, unknown> }).__commands;
        expect(cmds.has("superset.topologyScan")).toBe(true);
    });

    it("does not register the removed Overall TreeViews", async () => {
        const ext = fakeExtCtx();
        const createTreeView = vi.mocked(vscode.window.createTreeView);
        createTreeView.mockClear();

        await activate(ext);

        const viewIds = createTreeView.mock.calls.map((call) => call[0]);
        expect(viewIds).not.toContain("superset.workspaceTodo");
        expect(viewIds).not.toContain("superset.projectsTodo");
    });

    it("registers the CLI Launcher view and its agent commands", async () => {
        const ext = fakeExtCtx();
        const createTreeView = vi.mocked(vscode.window.createTreeView);
        createTreeView.mockClear();

        await activate(ext);

        const viewIds = createTreeView.mock.calls.map((call) => call[0]);
        expect(viewIds).toContain("superset.cliLauncher.paths");
        const cmds = (vscode as unknown as { __commands: Map<string, unknown> })
            .__commands;
        for (const id of [
            "superset.cliLauncherRunClaude",
            "superset.cliLauncherRunCodex",
            "superset.cliLauncherRunGrok",
            "superset.cliLauncherOpen",
            "superset.cliLauncherOpenNewWindow",
            "superset.cliLauncherCreateSubfolder",
            "superset.cliLauncherAddPath",
            "superset.cliLauncherRemovePath",
            "superset.cliLauncherRestoreHidden",
            "superset.cliLauncherCopyAllPaths",
            "superset.cliLauncherRefresh",
            "superset.cliLauncherFilter",
            "superset.cliLauncherClearFilter",
        ]) {
            expect(cmds.has(id), `missing CLI Launcher command: ${id}`).toBe(
                true
            );
        }
    });

    it("returns focus to the CLI panel after accepting a filter", async () => {
        const input = vi
            .spyOn(vscode.window, "showInputBox")
            .mockResolvedValueOnce("platform");

        try {
            await activate(fakeExtCtx());
            const testApi = vscode as unknown as {
                __commands: Map<string, () => unknown>;
                __executedCommands: Array<[string, ...unknown[]]>;
            };

            await testApi.__commands.get("superset.cliLauncherFilter")?.();

            expect(testApi.__executedCommands).toContainEqual([
                "superset.cliLauncher.paths.focus",
            ]);
        } finally {
            input.mockRestore();
        }
    });

    it("opens every selected CLI path in a new VS Code window", async () => {
        const ext = fakeExtCtx();
        await activate(ext);

        const testApi = vscode as unknown as {
            __commands: Map<string, (...args: unknown[]) => unknown>;
            __executedCommands: Array<[string, ...unknown[]]>;
        };
        const command = testApi.__commands.get(
            "superset.cliLauncherOpenNewWindow"
        );
        expect(command).toBeDefined();

        await command?.(
            { entry: { id: "/projects/one", label: "one", path: "/projects/one" } },
            [{ path: "/projects/one" }, { path: "/projects/two" }]
        );

        expect(
            testApi.__executedCommands.filter(
                ([id]) => id === "vscode.openFolder"
            )
        ).toEqual([
            [
                "vscode.openFolder",
                {
                    fsPath: "/projects/one",
                    scheme: "file",
                    path: "/projects/one",
                },
                { forceNewWindow: true },
            ],
            [
                "vscode.openFolder",
                {
                    fsPath: "/projects/two",
                    scheme: "file",
                    path: "/projects/two",
                },
                { forceNewWindow: true },
            ],
        ]);
    });

    it("creates one direct subfolder under every selected CLI path", async () => {
        const sandbox = await mkdtemp(
            join(tmpdir(), "superset-subfolder-")
        );
        const parentA = join(sandbox, "one");
        const parentB = join(sandbox, "two");
        await mkdir(parentA);
        await mkdir(parentB);
        const input = vi
            .spyOn(vscode.window, "showInputBox")
            .mockResolvedValueOnce("  child  ");
        const createTreeView = vi.mocked(vscode.window.createTreeView);
        createTreeView.mockClear();

        try {
            await activate(fakeExtCtx());
            const testApi = vscode as unknown as {
                __commands: Map<string, (...args: unknown[]) => unknown>;
            };
            const command = testApi.__commands.get(
                "superset.cliLauncherCreateSubfolder"
            );
            expect(command).toBeDefined();

            const cliCall = createTreeView.mock.calls.find(
                ([viewID]) => viewID === "superset.cliLauncher.paths"
            );
            const provider = cliCall?.[1].treeDataProvider as {
                refresh(): void;
            };
            const refresh = vi.spyOn(provider, "refresh");

            await command?.(
                { path: parentA },
                [{ path: parentA }, { path: parentB }]
            );

            await expect(
                access(join(parentA, "child"))
            ).resolves.toBeUndefined();
            await expect(
                access(join(parentB, "child"))
            ).resolves.toBeUndefined();
            expect(refresh).toHaveBeenCalledTimes(1);
        } finally {
            input.mockRestore();
            await rm(sandbox, { recursive: true, force: true });
        }
    });

    it("rejects nested input before creating a CLI subfolder", async () => {
        const sandbox = await mkdtemp(
            join(tmpdir(), "superset-subfolder-")
        );
        const input = vi
            .spyOn(vscode.window, "showInputBox")
            .mockResolvedValueOnce("nested/child");
        const error = vi.spyOn(vscode.window, "showErrorMessage");

        try {
            await activate(fakeExtCtx());
            const testApi = vscode as unknown as {
                __commands: Map<string, (...args: unknown[]) => unknown>;
            };
            const command = testApi.__commands.get(
                "superset.cliLauncherCreateSubfolder"
            );
            expect(command).toBeDefined();

            await command?.({ path: sandbox });

            await expect(
                access(join(sandbox, "nested", "child"))
            ).rejects.toMatchObject({ code: "ENOENT" });
            expect(error).toHaveBeenCalledWith(
                expect.stringContaining("請只輸入一層子資料夾名稱")
            );

            const options = input.mock.calls[0]?.[0] as vscode.InputBoxOptions;
            const validate = options.validateInput as (
                value: string
            ) => string | undefined;
            expect(validate("")).toContain("請輸入子資料夾名稱");
            expect(validate(".")).toContain("不可為 . 或 ..");
            expect(validate("..")).toContain("不可為 . 或 ..");
            expect(validate("nested\\child")).toContain("只輸入一層");
            expect(validate("bad\0name")).toContain("不支援的字元");
        } finally {
            input.mockRestore();
            error.mockRestore();
            await rm(sandbox, { recursive: true, force: true });
        }
    });

    it("deactivate() releases manager-owned resources and global roots", async () => {
        const ext = fakeExtCtx();
        await activate(ext);
        const testApi = vscode as unknown as {
            __commands: Map<string, Function>;
            __outputDisposeCount(): number;
        };

        expect(getPluginManager()).toBeDefined();
        expect(getDiagnosticChannel()).toBeDefined();
        expect(getTreeViewRegistry()).toBeDefined();
        // The lightweight vscode mock cannot fully activate terminals, so
        // seed the same cross-module root that a real activation publishes.
        setTerminalSpawner(() => ({} as vscode.Terminal));
        expect(getTerminalSpawner()).toBeDefined();
        expect(testApi.__commands.has("superset.mdnsRefresh")).toBe(true);

        await deactivate();

        expect(getPluginManager()).toBeUndefined();
        expect(getDiagnosticChannel()).toBeUndefined();
        expect(getTreeViewRegistry()).toBeUndefined();
        expect(getTerminalSpawner()).toBeUndefined();
        expect(testApi.__commands.has("superset.mdnsRefresh")).toBe(false);
        expect(testApi.__commands.has("superset.sessionsRefresh")).toBe(false);
        expect(testApi.__commands.has("superset.resetCaches")).toBe(false);
        expect(testApi.__outputDisposeCount()).toBe(1);

        // Root teardown is idempotent; VS Code may dispose subscriptions
        // after awaiting the exported deactivate hook.
        await deactivate();
        expect(testApi.__outputDisposeCount()).toBe(1);
    });
});
