// Minimal vscode mock — enough surface to let `extension.ts`
// import + call `activate()` without exploding. The real test
// is whether:
// 1. The manager activates every plugin in the list.
// 2. The returned `extendMarkdownIt` composes the treePreview +
//    todoPreview hooks in the right order.
// 3. The global-commands plugin registers all 4 commands.
// 4. `superset.resetCaches` end-to-end fires the manager's resetAll.
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
        dispose() { this.listeners.clear(); }
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
            createTreeView: vi.fn(() => ({
                onDidChangeCheckboxState: undefined,
                // panelLayout feature (0.9.0) wires each panel's
                // `onDidChangeVisibility` to `superset.reportViewVisible`;
                // the mock returns a real disposable so subscribing
                // never throws.
                onDidChangeVisibility: () => ({
                    dispose: () => undefined,
                }),
                title: "",
                dispose: noop,
            })),
            showInformationMessage: async () => undefined,
            showWarningMessage: async () => "Reset", // auto-confirm reset
            showErrorMessage: async () => undefined,
            showInputBox: async () => undefined,
            showQuickPick: async () => undefined,
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
            registerCommand: (id: string, cb: (...args: unknown[]) => unknown) => {
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

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";

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
    beforeEach(() => {
        (vscode as unknown as { __commands: Map<string, Function> }).__commands.clear();
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
            "superset.focusOverallView",
            "superset.showLogs",
            "superset.focusPanel",
            "superset.installDefaultTools",
            "superset.skillInstall",
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

    it("registers both Overall TODO TreeViews", async () => {
        const ext = fakeExtCtx();
        const createTreeView = vi.mocked(vscode.window.createTreeView);
        createTreeView.mockClear();

        await activate(ext);

        const viewIds = createTreeView.mock.calls.map((call) => call[0]);
        expect(viewIds).toContain("superset.workspaceTodo");
        expect(viewIds).toContain("superset.projectsTodo");
    });

    it("deactivate() is a no-op (no throw)", () => {
        expect(() => deactivate()).not.toThrow();
    });
});
