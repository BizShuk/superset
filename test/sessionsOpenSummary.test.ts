import { describe, expect, it, vi } from "vitest";
import { ensureMarkdownDocument } from "../src/sessions/openSummary";

describe("ensureMarkdownDocument", () => {
    it("uses the replacement document returned by VS Code", async () => {
        const jsonlDocument = {
            languageId: "jsonl",
            uri: "session:jsonl",
        };
        const markdownDocument = {
            languageId: "markdown",
            uri: "session:markdown",
        };
        const setLanguage = vi.fn(async () => markdownDocument);

        await expect(
            ensureMarkdownDocument(jsonlDocument, setLanguage)
        ).resolves.toBe(markdownDocument);
        expect(setLanguage).toHaveBeenCalledOnce();
        expect(markdownDocument.uri).not.toBe(jsonlDocument.uri);
    });

    it("keeps an existing Markdown document without reopening it", async () => {
        const markdownDocument = {
            languageId: "markdown",
            uri: "session:markdown",
        };
        const setLanguage = vi.fn();

        await expect(
            ensureMarkdownDocument(markdownDocument, setLanguage)
        ).resolves.toBe(markdownDocument);
        expect(setLanguage).not.toHaveBeenCalled();
    });
});
