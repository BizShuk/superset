import { describe, it, expect } from "vitest";
import {
    wrapSections,
    isTodoDoc,
    type TokenLike,
    type TokenFactory,
} from "../src/todoPreview/sectionWrap";

// Plain-object stand-in for markdown-it's Token constructor.
const make: TokenFactory = (type, tag, nesting) => ({
    type,
    tag,
    nesting,
    content: "",
    block: false,
});

// Build the heading_open / inline / heading_close triple markdown-it emits.
function heading(tag: string, text: string): TokenLike[] {
    return [
        { ...make("heading_open", tag, 1) },
        { ...make("inline", "", 0), content: text },
        { ...make("heading_close", tag, -1) },
    ];
}

function para(text: string): TokenLike {
    return { ...make("paragraph_open", "p", 1), content: text };
}

// Concatenate every html_block content so assertions can scan the output.
function htmlOf(tokens: TokenLike[]): string {
    return tokens
        .filter((t) => t.type === "html_block")
        .map((t) => t.content)
        .join("");
}

describe("isTodoDoc", () => {
    it("is true when the first heading is a top-level # TODO", () => {
        expect(isTodoDoc(heading("h1", "TODO"))).toBe(true);
    });

    it("is false for a non-TODO first heading", () => {
        expect(isTodoDoc(heading("h1", "README"))).toBe(false);
        expect(isTodoDoc(heading("h2", "TODO"))).toBe(false);
        expect(isTodoDoc([para("no headings here")])).toBe(false);
    });
});

describe("wrapSections", () => {
    it("passes non-TODO docs through untouched", () => {
        const tokens = [...heading("h1", "README"), para("body")];
        expect(wrapSections(tokens, make)).toBe(tokens);
    });

    it("wraps the whole doc in a .todo-preview container with a filter bar", () => {
        const out = wrapSections(heading("h1", "TODO"), make);
        const html = htmlOf(out);
        expect(html).toContain('<div class="todo-preview">');
        expect(html).toContain('<div class="filter-bar">');
        expect(html).toContain('id="hide-done"');
        expect(html).toContain('id="fold-all"');
        // Opening wrapper is balanced by a closing div at the very end.
        expect(out[out.length - 1].content).toBe("</div>");
    });

    it("wraps each heading into its own .sec with a unique id and data-title", () => {
        const tokens = [
            ...heading("h1", "TODO"),
            para("intro"),
            ...heading("h2", "Terminals"),
            para("t1"),
            ...heading("h2", "Archive"),
        ];
        const out = wrapSections(tokens, make);
        const html = htmlOf(out);
        expect(html).toContain(
            '<section class="sec" data-title="TODO">'
        );
        expect(html).toContain(
            '<section class="sec" data-title="Terminals">'
        );
        expect(html).toContain(
            '<section class="sec sec--archive" data-title="Archive">'
        );
        expect(html).toContain('id="sec-1"');
        expect(html).toContain('id="sec-2"');
        expect(html).toContain('id="sec-3"');
    });

    it("re-emits the real heading tokens inside the label", () => {
        const out = wrapSections(heading("h1", "TODO"), make);
        expect(out.some((t) => t.type === "heading_open")).toBe(true);
        expect(out.some((t) => t.type === "heading_close")).toBe(true);
    });

    it("balances every section open with a close", () => {
        const tokens = [
            ...heading("h1", "TODO"),
            ...heading("h2", "A"),
            ...heading("h2", "B"),
        ];
        const html = htmlOf(wrapSections(tokens, make));
        const opens = (html.match(/<section/g) ?? []).length;
        const closes = (html.match(/<\/section>/g) ?? []).length;
        expect(opens).toBe(3);
        expect(closes).toBe(3);
    });

    it("escapes quotes/brackets in the data-title", () => {
        const out = wrapSections(heading("h1", "TODO").concat(heading("h2", 'A"<b>')), make);
        const html = htmlOf(out);
        expect(html).toContain('data-title="A&quot;&lt;b&gt;"');
        expect(html).not.toContain('data-title="A"<b>"');
    });
});
