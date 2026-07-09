// Reveal-in-tree wiring for the terminals panel. See
// `plans/2026-07-05-architecture-reveal-in-tree.md` §6 step 4: the
// terminals treeView must be registered into the cross-panel
// TreeViewRegistry so `superset.revealInTree` and the
// `superset.revealTerminal` shortcut can walk + reveal rows.

import { describe, it, expect, vi, beforeEach } from "vitest";

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
    return {
        EventEmitter,
        Uri: {
            file: (p: string) => ({ fsPath: p, scheme: "file", path: p }),
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
                onDidChangeVisibility: () => noopDisposable,
                title: "",
                message: "",
                description: "",
                reveal: async () => {},
                dispose: noop,
            }),
            terminals: [],
            activeTerminal: undefined,
            onDidOpenTerminal: () => noopDisposable,
            onDidCloseTerminal: () => noopDisposable,
            onDidChangeActiveTerminal: () => noopDisposable,
            onDidStartTerminalShellExecution: () => noopDisposable,
            onDidEndTerminalShellExecution: () => noopDisposable,
            registerTerminalLinkProvider: () => noopDisposable,
            onDidChangeActiveTextEditor: () => noopDisposable,
            showInformationMessage: async () => undefined,
            showWarningMessage: async () => undefined,
            showErrorMessage: async () => undefined,
            showInputBox: async () => undefined,
            showQuickPick: async () => undefined,
        },
        workspace: {
            workspaceFolders: undefined,
            openTextDocument: async () => ({}),
            getConfiguration: () => ({ get: () => undefined }),
        },
        env: {
            sessionId: "test-session",
            clipboard: { writeText: async () => {} },
        },
        commands: {
            registerCommand: (_id: string, _cb: (...a: unknown[]) => unknown) =>
                noopDisposable,
            executeCommand: async () => undefined,
        },
        StatusBarAlignment: { Left: 0, Right: 1 },
        Disposable: { from: () => noopDisposable },
    };
});

const { terminalsPlugin } = await import("../src/terminals/plugin");
const {
    setTreeViewRegistry,
    getTreeViewRegistry,
    TreeViewRegistry,
} = await import("../src/plugin/treeViewRegistry");
import type { PluginContext } from "../src/plugin";

function fakePluginContext(): PluginContext {
    return {
        extensionUri: { fsPath: "/fake" } as never,
        globalState: {
            get: () => undefined,
            update: async () => {},
        } as unknown as PluginContext["globalState"],
        workspaceState: {
            get: () => undefined,
            update: async () => {},
        } as unknown as PluginContext["workspaceState"],
        workspaceFolder: undefined,
        registerDisposable: () => ({ dispose: () => undefined }),
        log: () => {},
    } as unknown as PluginContext;
}

describe("terminals plugin — reveal-in-tree wiring", () => {
    beforeEach(() => {
        // Reset the registry singleton so the test starts clean;
        // setTreeViewRegistry is the only legal way to seed the
        // singleton, mirroring what `extension.ts` does before any
        // plugin activates.
        setTreeViewRegistry(new TreeViewRegistry());
    });

    it("registers the superset.terminals viewId into the cross-panel TreeViewRegistry on activate", () => {
        const reg = getTreeViewRegistry();
        expect(reg).toBeDefined();
        expect(reg?.get("superset.terminals")).toBeUndefined();

        terminalsPlugin.activate(fakePluginContext());

        const after = getTreeViewRegistry();
        expect(after?.get("superset.terminals")).toBeDefined();
        expect(after?.listViewIds()).toContain("superset.terminals");
    });

    it("exposes the expected plugin id", () => {
        expect(terminalsPlugin.id).toBe("terminals");
    });
});
