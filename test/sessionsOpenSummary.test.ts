import { describe, expect, it, vi } from "vitest";
import { ensureMarkdownDocument } from "../src/sessions/openSummary";

describe("ensureMarkdownDocument", () => {
    it("uses the replacement document returned by VS Code", async () => {
        const jsonlDocument = { languageId: "jsonl", content: "" };
        const markdownDocument = {
            languageId: "markdown",
            content: "# Rendered session",
        };
        const setLanguage = vi.fn(async () => markdownDocument);

        await expect(
            ensureMarkdownDocument(jsonlDocument, setLanguage)
        ).resolves.toBe(markdownDocument);
        expect(setLanguage).toHaveBeenCalledWith(
            jsonlDocument,
            "markdown"
        );
    });

    it("keeps an existing Markdown document without reopening it", async () => {
        const markdownDocument = {
            languageId: "markdown",
            content: "# Rendered session",
        };
        const setLanguage = vi.fn();

        await expect(
            ensureMarkdownDocument(markdownDocument, setLanguage)
        ).resolves.toBe(markdownDocument);
        expect(setLanguage).not.toHaveBeenCalled();
    });
});
