import { describe, it, expect } from "vitest";
import { parseTodoFile } from "../src/todo/parser";

describe("parseTodoFile", () => {
    it("returns [] for an empty string", () => {
        expect(parseTodoFile("")).toEqual([]);
    });

    it("wraps top-level checkboxes under a synthetic Default section", () => {
        const items = parseTodoFile("- [ ] a\n- [x] b\n");
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ text: "Default", kind: "section" });
        expect(items[0]!.children?.map((c) => c.text)).toEqual(["a", "b"]);
        expect(items[0]!.children?.[1]?.checked).toBe(true);
    });

    it("honours heading line indices for section items", () => {
        const items = parseTodoFile(
            "# TODO\n- [ ] root\n## Features\n- [x] feat\n"
        );
        // Default section (has children) + Features section.
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({ text: "Default", line: -1, kind: "section" });
        expect(items[1]).toMatchObject({ text: "Features", line: 2, kind: "section" });
        expect(items[1]!.children?.[0]).toMatchObject({
            text: "feat",
            line: 3,
            kind: "checkbox",
            checked: true,
        });
    });

    it("preserves the source line index for each emitted item", () => {
        const src = "# TODO\n- [ ] line1\n  - [ ] line2\n- [x] line3\n";
        const items = parseTodoFile(src);
        const defaultItems = items[0]!.children!;
        expect(defaultItems[0]!.line).toBe(1);
        expect(defaultItems[0]!.children?.[0]?.line).toBe(2);
        expect(defaultItems[1]!.line).toBe(3);
    });

    it("keeps bare list markers as kind='list'", () => {
        const items = parseTodoFile("- bare item\n  * nested\n");
        const list = items[0]!.children![0]!;
        expect(list).toMatchObject({ kind: "list", text: "bare item" });
        expect(list.children?.[0]).toMatchObject({ kind: "list", text: "nested" });
    });

    it("drops headings, quotes, and plain paragraphs (even indented)", () => {
        const items = parseTodoFile(
            "## Section\n\n> a quote\nplain paragraph\n- [x] kept\n"
        );
        expect(items).toHaveLength(1);
        expect(items[0]!.children?.map((c) => c.text)).toEqual(["kept"]);
    });

    it("accepts -, *, and + as list markers", () => {
        const items = parseTodoFile(
            "* [ ] star\n+ [x] plus\n- [ ] dash\n"
        );
        const texts = items[0]!.children!.map((c) => [c.text, c.checked]);
        expect(texts).toEqual([
            ["star", false],
            ["plus", true],
            ["dash", false],
        ]);
    });

    it("does not emit Default section when there are no top-level items", () => {
        const items = parseTodoFile("## Only\n- [x] feat\n");
        expect(items).toHaveLength(1);
        expect(items[0]!.text).toBe("Only");
    });
});
