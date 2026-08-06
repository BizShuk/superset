import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as VSCode from "vscode";
import type { PluginContext } from "../src/plugin";

vi.mock("vscode", () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const executeCommand = vi.fn(
        async (id: string, ...args: unknown[]): Promise<unknown> => {
            return handlers.get(id)?.(...args);
        }
    );
    return {
        commands: {
            registerCommand: (
                id: string,
                handler: (...args: unknown[]) => unknown
            ) => {
                handlers.set(id, handler);
                return { dispose: () => handlers.delete(id) };
            },
            executeCommand,
        },
        window: {
            showWarningMessage: vi.fn(async () => "Reset"),
            showInformationMessage: vi.fn(async () => undefined),
            showErrorMessage: vi.fn(async () => undefined),
            showInputBox: vi.fn(async () => undefined),
            showQuickPick: vi.fn(async () => undefined),
        },
        workspace: {
            openTextDocument: vi.fn(async () => ({ uri: { path: "/doc" } })),
        },
        Uri: {
            file: (path: string) => ({ fsPath: path, path, scheme: "file" }),
        },
        __handlers: handlers,
    };
});

import * as vscode from "vscode";
import { globalCommandsPlugin } from "../src/globalCommandsPlugin";

interface TestApi {
    __handlers: Map<string, (...args: unknown[]) => unknown>;
}

function createContext(): PluginContext {
    return {
        extensionUri: { fsPath: "/extension" } as VSCode.Uri,
        workspaceFolder: "/workspace",
        workspaceState: {
            keys: () => ["superset.cache", "other.key"],
            get: () => undefined,
            update: vi.fn(async () => undefined),
        } as unknown as VSCode.Memento,
        globalState: {
            get: () => undefined,
            update: async () => undefined,
        } as unknown as VSCode.Memento,
        log: vi.fn(),
        showLogs: vi.fn(),
        createTerminal: vi.fn(),
        registerDisposable: vi.fn(),
        registerResetHandler: vi.fn(),
        resetAll: vi.fn(async () => undefined),
        registerDiagnosticsProvider: vi.fn(),
        getRuntimeDiagnostics: vi.fn(() => ({
            activePluginIds: ["terminals", "mdns", "todo"],
            metrics: {
                terminalCount: 5,
                unseenTerminalCount: 2,
                mDNSServiceCount: 4,
                todoItemCount: 7,
            },
        })),
        registerTreeView: vi.fn(),
        revealInTree: vi.fn(async () => true),
    };
}

function command(id: string): (...args: unknown[]) => unknown {
    return (vscode as unknown as TestApi).__handlers.get(id)!;
}

describe("globalCommandsPlugin", () => {
    beforeEach(() => {
        (vscode as unknown as TestApi).__handlers.clear();
        vi.clearAllMocks();
    });

    it("runs every plugin reset handler after clearing workspace cache", async () => {
        const ctx = createContext();
        globalCommandsPlugin.activate(ctx);

        await command("superset.resetCaches")();

        expect(ctx.workspaceState.update).toHaveBeenCalledWith(
            "superset.cache",
            undefined
        );
        expect(ctx.workspaceState.update).not.toHaveBeenCalledWith(
            "other.key",
            undefined
        );
        expect(ctx.resetAll).toHaveBeenCalledOnce();
    });

    it("opens the native extension settings surface", async () => {
        const ctx = createContext();
        globalCommandsPlugin.activate(ctx);

        await command("superset.openSettings")();

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            "workbench.action.openSettings",
            "@ext:shuk.superset"
        );
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it("renders live runtime diagnostics from PluginContext", async () => {
        const ctx = createContext();
        globalCommandsPlugin.activate(ctx);

        await command("superset.showDiagnostics")();

        expect(ctx.getRuntimeDiagnostics).toHaveBeenCalledOnce();
        expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({
            content: expect.stringContaining("| Tracked terminals | 5 |"),
            language: "markdown",
        });
        const [{ content }] = vi.mocked(
            vscode.workspace.openTextDocument
        ).mock.calls[0] as [{ content: string; language: string }];
        expect(content).toContain("| mDNS services | 4 |");
        expect(content).toContain("| TODO tasks (active workspace) | 7 |");
        expect(content).toContain("- terminals");
    });
});
