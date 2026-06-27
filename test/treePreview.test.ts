import { describe, it, expect } from "vitest";
import { renderLine, type MarkdownItLike } from "../src/treePreview/renderLine";

// Stub markdown-it's escapeHtml with the same substitutions the real
// implementation performs, so the renderer's escaping path is exercised.
const md: MarkdownItLike = {
    utils: {
        escapeHtml: (s: string) =>
            s
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;"),
    },
};

describe("renderLine", () => {
    it("returns empty string for a blank line", () => {
        expect(renderLine(md, "")).toBe("");
        expect(renderLine(md, "   ")).toBe("");
    });

    it("renders a directory entry with the 📁 icon and tree-dir class", () => {
        const html = renderLine(md, "├── src/");
        expect(html).toContain('<span class="tree-connector">├── </span>');
        expect(html).toContain('<span class="tree-dir">📁 src/</span>');
    });

    it("renders a file entry with the 📄 icon and tree-file class", () => {
        const html = renderLine(md, "└── index.ts");
        expect(html).toContain('<span class="tree-connector">└── </span>');
        expect(html).toContain('<span class="tree-file">📄 index.ts</span>');
    });

    it("splits a trailing ' #' comment into its own tree-comment span", () => {
        const html = renderLine(md, "├── package.json # manifest");
        expect(html).toContain('<span class="tree-file">📄 package.json</span>');
        expect(html).toContain('<span class="tree-comment"> # manifest</span>');
    });

    it("handles a bare name with no connector prefix", () => {
        const html = renderLine(md, "root/");
        expect(html).toBe(
            '<span class="tree-connector"></span><span class="tree-dir">📁 root/</span>'
        );
    });

    it("escapes HTML in entry names", () => {
        const html = renderLine(md, "├── <script>.ts");
        expect(html).toContain("&lt;script&gt;.ts");
        expect(html).not.toContain("<script>.ts");
    });

    it("emits only the connector span when the line is connectors alone", () => {
        // Trailing whitespace is stripped, leaving the bare connector.
        const html = renderLine(md, "│   ");
        expect(html).toBe('<span class="tree-connector">│</span>');
    });
});
