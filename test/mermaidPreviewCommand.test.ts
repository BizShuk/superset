import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
    const executeCommand = vi.fn();
    const showInformationMessage = vi.fn();
    const showErrorMessage = vi.fn();
    const openTextDocument = vi.fn();
    const showTextDocument = vi.fn();
    const writeFile = vi.fn(async () => undefined);
    const mkdir = vi.fn(async () => undefined);
    return {
        executeCommand,
        showInformationMessage,
        showErrorMessage,
        openTextDocument,
        showTextDocument,
        writeFile,
        mkdir,
    };
});

vi.mock("vscode", () => {
    class Uri {
        static file(p: string): { fsPath: string; path: string } {
            return { fsPath: p, path: p };
        }
    }
    return {
        Uri,
        extensions: { all: [] },
        commands: {
            registerCommand: () => ({ dispose: () => undefined }),
            executeCommand: mocks.executeCommand,
        },
        window: {
            showInformationMessage: mocks.showInformationMessage,
            showErrorMessage: mocks.showErrorMessage,
            showTextDocument: mocks.showTextDocument,
            openTextDocument: async (uri: { fsPath: string }) => {
                mocks.openTextDocument(uri);
                return { uri, lineCount: 0, getText: () => "" };
            },
        },
        workspace: {
            openTextDocument: async (uri: { fsPath: string }) => {
                mocks.openTextDocument(uri);
                return { uri, lineCount: 0, getText: () => "" };
            },
        },
    };
});

vi.mock("fs/promises", () => ({
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
}));

import {
    runMermaidPreview,
    __test_only__,
} from "../src/terminals/mermaidPreviewCommand";

const { KNOWN_MERMAID_PACKAGES } = __test_only__;

function fakeExt(id: string, displayName?: string): unknown {
    return {
        id,
        packageJSON: displayName ? { displayName } : { displayName: id },
    };
}

function installedExtensionsOf(ids: string[]): readonly unknown[] {
    return ids.map((id) => fakeExt(id));
}

describe("runMermaidPreview", () => {
    beforeEach(() => {
        mocks.executeCommand.mockReset();
        mocks.showInformationMessage.mockReset();
        mocks.showErrorMessage.mockReset();
        mocks.openTextDocument.mockReset();
        mocks.showTextDocument.mockReset();
        mocks.writeFile.mockReset();
        mocks.writeFile.mockResolvedValue(undefined);
        mocks.mkdir.mockReset();
        mocks.mkdir.mockResolvedValue(undefined);
    });

    it("writes a fenced mermaid block and opens preview when extension installed", async () => {
        mocks.executeCommand.mockResolvedValue(undefined);

        const result = await runMermaidPreview("graph TD\n  A --> B", {
            tempDir: "/tmp",
            nextId: () => "test-1",
            log: () => undefined,
            installedExtensions: installedExtensionsOf(
                ["bierner.markdown-mermaid"]
            ) as never,
        });

        expect(result.installed).toBe(true);
        expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
        const [cmd, uri] = mocks.executeCommand.mock.calls[0]!;
        expect(cmd).toBe("markdown.showPreview");
        expect((uri as { fsPath: string }).fsPath).toBe(
            "/tmp/superset-mermaid-test-1.md"
        );
    });

    it("falls back to plain editor + notification when no mermaid extension", async () => {
        const log = vi.fn();
        await runMermaidPreview("graph LR\n  X --> Y", {
            tempDir: "/tmp",
            nextId: () => "test-2",
            log,
            installedExtensions: installedExtensionsOf(
                ["some.other-extension"]
            ) as never,
        });

        expect(mocks.executeCommand).not.toHaveBeenCalled();
        expect(mocks.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(mocks.openTextDocument).toHaveBeenCalledTimes(1);
        expect(mocks.showTextDocument).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("no mermaid extension installed")
        );
    });

    it("detects extension by displayName mermaid keyword (heuristic fallback)", async () => {
        mocks.executeCommand.mockResolvedValue(undefined);
        const result = await runMermaidPreview("pie\n  A: 1", {
            tempDir: "/tmp",
            nextId: () => "test-3",
            log: () => undefined,
            installedExtensions: installedExtensionsOf(
                ["publisher.weird-mermaid-fork"]
            ) as never,
        });
        expect(result.installed).toBe(true);
    });

    it("refuses to write when body is empty or whitespace-only", async () => {
        const result = await runMermaidPreview("", {
            tempDir: "/tmp",
            nextId: () => "x",
        });
        expect(result.installed).toBe(false);
        expect(mocks.executeCommand).not.toHaveBeenCalled();
        expect(mocks.openTextDocument).not.toHaveBeenCalled();
    });

    it("surfaces an error message when file write fails", async () => {
        mocks.writeFile.mockRejectedValueOnce(new Error("EACCES"));
        const result = await runMermaidPreview("graph TD\n  A --> B", {
            tempDir: "/restricted",
            nextId: () => "fail",
        });
        expect(result.installed).toBe(false);
        expect(mocks.showErrorMessage).toHaveBeenCalledWith(
            expect.stringContaining("EACCES")
        );
    });

    it("falls through to source view when preview command throws", async () => {
        mocks.executeCommand.mockRejectedValueOnce(new Error("boom"));
        await runMermaidPreview("graph TD\n  A --> B", {
            tempDir: "/tmp",
            nextId: () => "throw",
            installedExtensions: installedExtensionsOf(
                ["bierner.markdown-mermaid"]
            ) as never,
        });
        expect(mocks.openTextDocument).toHaveBeenCalledTimes(1);
        expect(mocks.showTextDocument).toHaveBeenCalledTimes(1);
    });

    it("formats the temp file as a single ```mermaid fenced block", async () => {
        mocks.executeCommand.mockResolvedValue(undefined);
        let capturedContent = "";
        mocks.writeFile.mockImplementationOnce(
            async (_p: string, content: string) => {
                capturedContent = content;
            }
        );

        await runMermaidPreview("graph TD\n  A --> B", {
            tempDir: "/tmp",
            nextId: () => "format",
            installedExtensions: installedExtensionsOf(
                ["bierner.markdown-mermaid"]
            ) as never,
        });

        expect(capturedContent).toContain("```mermaid");
        expect(capturedContent).toContain("graph TD");
        expect(capturedContent).toContain("A --> B");
        expect(capturedContent.trim().endsWith("```")).toBe(true);
    });

    it("known list includes the bierner mermaid extension", () => {
        expect(KNOWN_MERMAID_PACKAGES).toContain("bierner.markdown-mermaid");
    });
});
