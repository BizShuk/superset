import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const vscodeMocks = vi.hoisted(() => ({
    commands: new Map<string, (...args: unknown[]) => unknown>(),
    dataRoot: "",
    showErrorMessage: vi.fn(async () => undefined),
    showInformationMessage: vi.fn(async () => undefined),
    showWarningMessage: vi.fn(async () => "Delete"),
}));

vi.mock("vscode", () => {
    class EventEmitter<T> {
        private readonly listeners = new Set<(event: T) => void>();
        readonly event = (listener: (event: T) => void) => {
            this.listeners.add(listener);
            return { dispose: () => this.listeners.delete(listener) };
        };
        fire(event: T): void {
            for (const listener of this.listeners) listener(event);
        }
        dispose(): void {
            this.listeners.clear();
        }
    }

    const disposable = { dispose: vi.fn() };

    return {
        EventEmitter,
        Uri: {
            file: (filePath: string) => ({
                fsPath: filePath,
                path: filePath,
                scheme: "file",
            }),
            from: (parts: { scheme: string; path: string; query?: string }) => ({
                ...parts,
                fsPath: parts.path,
                query: parts.query ?? "",
            }),
        },
        commands: {
            executeCommand: vi.fn(async () => undefined),
            registerCommand: (
                id: string,
                callback: (...args: unknown[]) => unknown
            ) => {
                vscodeMocks.commands.set(id, callback);
                return {
                    dispose: () => vscodeMocks.commands.delete(id),
                };
            },
        },
        env: {
            clipboard: { writeText: vi.fn(async () => undefined) },
        },
        languages: {
            setTextDocumentLanguage: vi.fn(async (document) => document),
        },
        window: {
            createTreeView: vi.fn(() => ({
                visible: false,
                onDidChangeVisibility: vi.fn(() => disposable),
                dispose: vi.fn(),
            })),
            showErrorMessage: vscodeMocks.showErrorMessage,
            showInformationMessage: vscodeMocks.showInformationMessage,
            showTextDocument: vi.fn(async () => undefined),
            showWarningMessage: vscodeMocks.showWarningMessage,
        },
        workspace: {
            getConfiguration: vi.fn(() => ({
                get: (key: string) =>
                    key === "sessions.dataDir"
                        ? vscodeMocks.dataRoot
                        : undefined,
            })),
            openTextDocument: vi.fn(async () => ({
                languageId: "markdown",
                uri: {},
            })),
            registerTextDocumentContentProvider: vi.fn(() => disposable),
            textDocuments: [],
        },
    };
});

import { register } from "../src/sessions";
import { workspaceSessionsDir } from "../src/sessions/store";
import type { SessionsElement } from "../src/sessions/sessionsTreeProvider";
import type { FeatureContext, FeatureHandle } from "../src/shared";

let root = "";
let handle: FeatureHandle | undefined;

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "superset-sessions-command-"));
    vscodeMocks.dataRoot = root;
    vscodeMocks.commands.clear();
    vscodeMocks.showErrorMessage.mockClear();
    vscodeMocks.showInformationMessage.mockClear();
    vscodeMocks.showWarningMessage.mockClear();
});

afterEach(() => {
    handle?.dispose();
    handle = undefined;
    rmSync(root, { recursive: true, force: true });
});

describe("Sessions Delete command", () => {
    it("deletes the selected session without a confirmation popup", async () => {
        const workspace = "/workspace/superset";
        const directory = workspaceSessionsDir(workspace, root);
        const filePath = path.join(
            directory,
            "019f8d13-bb33-7862-ab7b-2d5ddb26f4b4.jsonl"
        );
        mkdirSync(directory, { recursive: true });
        writeFileSync(
            filePath,
            `${JSON.stringify({
                type: "meta",
                agent: "codex",
                session_id: "019f8d13-bb33-7862-ab7b-2d5ddb26f4b4",
                workspace_path: workspace,
                title: "Delete me",
                created_at: "2026-08-06T00:00:00.000Z",
                schema_version: 1,
            })}\n`
        );

        const log = vi.fn();
        const context = {
            context: {} as vscode.ExtensionContext,
            subscriptions: [],
            workspaceFolder: workspace,
            shared: {
                statusBar: {} as vscode.StatusBarItem,
                diag: {} as vscode.OutputChannel,
                log,
            },
            resetHandlers: [],
        } satisfies FeatureContext;
        handle = register(context);

        const record = {
            meta: {
                type: "meta" as const,
                agent: "codex",
                session_id: "019f8d13-bb33-7862-ab7b-2d5ddb26f4b4",
                workspace_path: workspace,
                title: "Delete me",
                created_at: "2026-08-06T00:00:00.000Z",
                schema_version: 1,
            },
            turns: [],
            filePath,
            sizeBytes: 1,
            lastActiveMs: 0,
            malformedLines: 0,
        };
        const element: SessionsElement = { kind: "session", record };

        await vscodeMocks.commands.get("superset.sessionsDelete")?.(element);

        expect(vscodeMocks.showWarningMessage).not.toHaveBeenCalled();
        expect(vscodeMocks.showErrorMessage).not.toHaveBeenCalled();
        expect(existsSync(filePath)).toBe(false);
        expect(log).toHaveBeenCalledWith(`sessions: deleted ${filePath}`);
    });
});
