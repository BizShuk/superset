// Pure rendering of a single `tree` code-block line into HTML.
//
// Ported from the standalone `md-tree-highlight` extension. Kept free of
// any `vscode` import so it can be unit-tested directly (see
// test/treePreview.test.ts). The only external dependency is markdown-it's
// `md.utils.escapeHtml`, injected via the `md` argument.

const CONNECTOR = /[│├└─┌┐┘┬┴┼]/;

/** Minimal slice of the markdown-it instance this renderer needs. */
export interface MarkdownItLike {
    utils: { escapeHtml(s: string): string };
}

// Split a single tree line into its connector prefix and the entry name,
// preserving an optional trailing "# comment".
//
// Comment detection accepts any "#" on the line (no leading-space
// requirement) so that `package.json#manifest` is also recognised as
// "file + tag". The renderer restores the visual " #" prefix in the
// output span so the preview still looks like a space-separated
// comment; see `test/treePreview.test.ts` for the expected strings.
export function renderLine(md: MarkdownItLike, raw: string): string {
    const line = raw.replace(/\s+$/, "");
    if (line.length === 0) {
        return "";
    }

    // Trailing comment (kept outside the entry name). We pick the first
    // "#" on the line so that no-space forms like `file.json#tag` are
    // also treated as a comment; we then trim trailing whitespace off
    // the body so the file name does not pick up a stray space.
    let comment = "";
    const hashIdx = line.indexOf("#");
    let body = line;
    if (hashIdx !== -1) {
        // Ensure the comment span always starts with a single space so
        // the rendered preview visually separates "# comment" from the
        // preceding file/dir name, regardless of whether the source
        // line had a space before the "#".
        const tail = line.slice(hashIdx);
        comment = tail.startsWith(" ") ? tail : " " + tail;
        body = line.slice(0, hashIdx).replace(/\s+$/, "");
    }

    // The connector prefix is the leading run of box-drawing chars + spaces.
    let i = 0;
    while (i < body.length && (CONNECTOR.test(body[i]) || body[i] === " ")) {
        i++;
    }
    const prefix = body.slice(0, i);
    const name = body.slice(i);
    const isDir = /\/\s*$/.test(name);

    const esc = (s: string) => md.utils.escapeHtml(s);
    const nameClass = isDir ? "tree-dir" : "tree-file";
    const icon = isDir ? "📁" : "📄";

    return (
        `<span class="tree-connector">${esc(prefix)}</span>` +
        (name ? `<span class="${nameClass}">${icon} ${esc(name)}</span>` : "") +
        (comment ? `<span class="tree-comment">${esc(comment)}</span>` : "")
    );
}
