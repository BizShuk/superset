// Pure markdown-it token transform for the README.todo preview.
//
// Wraps every heading-led section into a `<section class="sec">` container
// (with a hidden checkbox + clickable `<label>` head) and injects a sticky
// filter bar at the top. All interactivity is then pure CSS (see
// styles/todo-preview.css) — no preview JS, so CSP and re-render are non-issues.
//
// Kept free of any `vscode` import so it can be unit-tested directly (see
// test/todoPreview.test.ts). The markdown-it `Token` constructor is injected
// via the `make` factory, mirroring the injection style used elsewhere
// (renderLine's escapeHtml, mDNS registry's clock).

export interface TokenLike {
    type: string;
    tag: string;
    nesting: number;
    content: string;
    block: boolean;
    children?: TokenLike[] | null;
}

export type TokenFactory = (
    type: string,
    tag: string,
    nesting: number
) => TokenLike;

const FILTER_BAR =
    '<div class="filter-bar">' +
    '<input type="checkbox" id="hide-done" class="fbox">' +
    '<label for="hide-done" class="fbtn hide-done"></label>' +
    '<input type="checkbox" id="fold-all" class="fbox">' +
    '<label for="fold-all" class="fbtn fold-all"></label>' +
    "</div>";

// Attribute-escape a heading's text for the `data-title` attribute.
function escAttr(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Gate: only treat a document as a TODO doc when its first heading is a
// top-level `# TODO`. This keeps every other Markdown preview untouched —
// the core ruler is global, so without this guard it would restructure all
// markdown files' sections.
export function isTodoDoc(tokens: TokenLike[]): boolean {
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type === "heading_open") {
            const inline = tokens[i + 1];
            return (
                tokens[i].tag === "h1" &&
                !!inline &&
                inline.content.trim() === "TODO"
            );
        }
    }
    return false;
}

// Rebuild the token stream: `.todo-preview` wrapper → filter bar → one
// `<section>` per heading. Non-TODO docs pass through untouched.
export function wrapSections(
    tokens: TokenLike[],
    make: TokenFactory
): TokenLike[] {
    if (!isTodoDoc(tokens)) return tokens;

    const html = (content: string): TokenLike => {
        const t = make("html_block", "", 0);
        t.content = content;
        t.block = true;
        return t;
    };

    const out: TokenLike[] = [];
    out.push(html('<div class="todo-preview">'));
    out.push(html(FILTER_BAR));

    let inSection = false;
    let counter = 0;

    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.type === "heading_open") {
            if (inSection) out.push(html("</div></section>"));
            counter++;
            const id = `sec-${counter}`;
            const inline = tokens[i + 1];
            const rawTitle = (inline?.content ?? "").trim();
            const title = escAttr(rawTitle);
            // Use a class (guaranteed to survive VSCode's preview sanitizer —
            // task lists rely on class names) rather than a data-attribute to
            // flag the Archive section for the hide-done filter.
            const cls =
                /^archive$/i.test(rawTitle) ? "sec sec--archive" : "sec";
            out.push(
                html(
                    `<section class="${cls}" data-title="${title}">` +
                        `<input type="checkbox" class="sec-tgl" id="${id}">` +
                        `<label class="sec-head" for="${id}">`
                )
            );
            // Re-emit the heading tokens (heading_open … inline … heading_close)
            // so markdown-it still renders the real <hN> inside the label.
            out.push(tok);
            let j = i + 1;
            while (j < tokens.length && tokens[j].type !== "heading_close") {
                out.push(tokens[j]);
                j++;
            }
            if (j < tokens.length) out.push(tokens[j]); // heading_close
            out.push(html('</label><div class="sec-body">'));
            inSection = true;
            i = j;
            continue;
        }
        out.push(tok);
    }

    if (inSection) out.push(html("</div></section>"));
    out.push(html("</div>"));
    return out;
}
