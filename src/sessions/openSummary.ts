type TextDocumentLike = {
    readonly languageId: string;
    readonly uri: unknown;
};

/**
 * Promote the virtual session document from its native language (jsonl) to
 * Markdown. `setTextDocumentLanguage` closes the original document and
 * returns its replacement, which the caller must use for the preview URI.
 */
export async function ensureMarkdownDocument(
    document: TextDocumentLike,
    promote: () => Thenable<TextDocumentLike>
): Promise<TextDocumentLike> {
    if (document.languageId === "markdown") return document;
    return promote();
}
