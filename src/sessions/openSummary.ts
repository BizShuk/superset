interface TextDocumentLike {
    readonly languageId: string;
}

type SetDocumentLanguage<T extends TextDocumentLike> = (
    document: T,
    languageId: string
) => Thenable<T>;

/**
 * Promote the virtual session document from its native language (jsonl) to
 * Markdown. `setTextDocumentLanguage` closes the original document and
 * returns its replacement — the markdown preview extension keys on
 * `languageId === "markdown"`, so callers must hand the returned document
 * (or its URI) to `markdown.showPreview`.
 */
export async function ensureMarkdownDocument<T extends TextDocumentLike>(
    document: T,
    setLanguage: SetDocumentLanguage<T>
): Promise<T> {
    if (document.languageId === "markdown") return document;
    return setLanguage(document, "markdown");
}
