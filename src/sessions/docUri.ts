// Pure helpers for the virtual-document URI used to render a session as
// Markdown in the editor.
//
// We depend on the SHAPE of `vscode.Uri`, not on the `vscode` module —
// so this file has no `import "vscode"` and the helpers are unit-testable
// without the host API in scope.
//
// Why the path is NOT the file path
// ─────────────────────────────────
// Earlier versions stored the backing `.jsonl` path directly in the URI's
// path segment: `superset-session:/Users/.../%2F.../sample-x.jsonl.md`.
// VSCode then *normalises* the URI: leading slashes get folded and `%2F`
// in directory names round-trips back to `/`, producing a path that no
// longer matches the real file. Every click on a session row opened the
// "Session 已不存在" placeholder instead of the rendered markdown.
//
// Putting the real path in the `query` parameter avoids that round-trip —
// `Uri.query` is left alone by normalisation. The path component stays
// deterministic (`/<session_id>.md`) so the document still parses as
// Markdown and shows up under a meaningful tab title.

/** The subset of `vscode.Uri` that the helpers here touch. */
export interface SessionDocUri {
    readonly scheme: string;
    readonly path: string;
    readonly query: string;
    with(opts: { query?: string }): SessionDocUri;
}

/** Scheme registered for the session markdown documents. */
export const SESSION_DOC_SCHEME = "superset-session";

/** Build the virtual-document URI for a session. */
export function sessionDocUri(filePath: string): SessionDocUri {
    const id = filePath.replace(/.*\//, "").replace(/\.jsonl$/, "");
    const base: SessionDocUri = {
        scheme: SESSION_DOC_SCHEME,
        path: `/${id}.md`,
        query: "",
        with(opts) {
            return { ...this, ...opts };
        },
    };
    return base.with({ query: filePath });
}

/**
 * Inverse of `sessionDocUri`. Returns the backing `.jsonl` path, or
 * `undefined` if the URI is not one of ours (or is malformed).
 */
export function sessionPathFromDocUri(uri: SessionDocUri): string | undefined {
    if (uri.scheme !== SESSION_DOC_SCHEME) return undefined;
    const q = uri.query;
    if (!q || !q.startsWith("/")) return undefined;
    return q;
}
