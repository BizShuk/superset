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
export function renderLine(md: MarkdownItLike, raw: string): string {
    const line = raw.replace(/\s+$/, "");
    if (line.length === 0) {
        return "";
    }

    // Trailing comment (kept outside the entry name).
    let comment = "";
    const hashIdx = line.indexOf("#");
    let body = line;
    if (hashIdx !== -1) {
        comment = line.slice(hashIdx);
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
        (comment ? `<span class="tree-comment"> ${esc(comment)}</span>` : "")
    );
}
