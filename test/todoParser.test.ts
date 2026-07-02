import { describe, it, expect } from "vitest";
import { parseTodoFile, isArchivedSubsection } from "../src/todo/parser";
import type { TodoItem } from "../src/todo/types";

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

    it("records heading depth on section items via `level`", () => {
        const items = parseTodoFile(
            "## Features\n- [ ] a\n### Iteration 2\n- [ ] b\n"
        );
        expect(items[0]).toMatchObject({ text: "Features", level: 2 });
        expect(items[1]).toMatchObject({ text: "Iteration 2", level: 3 });
    });

    it("leaves `level` undefined for the synthetic Default section", () => {
        const items = parseTodoFile("- [ ] a\n");
        expect(items[0]!.level).toBeUndefined();
    });
});

describe("isArchivedSubsection", () => {
    const section = (text: string, line: number, level?: number): TodoItem => ({
        line,
        text,
        kind: "section",
        checked: false,
        level,
    });

    it("is true for a level-3 heading whose nearest <=2 ancestor is Archive", () => {
        const sections = [
            section("Features", 0, 2),
            section("Archive", 5, 2),
            section("Terminals", 7, 3),
        ];
        expect(isArchivedSubsection(sections, sections[2]!)).toBe(true);
    });

    it("is false when the nearest <=2 ancestor is not Archive", () => {
        const sections = [
            section("Features", 0, 2),
            section("Iteration 2", 2, 3),
        ];
        expect(isArchivedSubsection(sections, sections[1]!)).toBe(false);
    });

    it("is false for a level-2 heading, even inside Archive's document range", () => {
        const sections = [
            section("Archive", 0, 2),
            section("Standalone", 5, 2),
        ];
        expect(isArchivedSubsection(sections, sections[1]!)).toBe(false);
    });

    it("is false for the synthetic Default section (no level)", () => {
        const sections = [section("Default", -1, undefined)];
        expect(isArchivedSubsection(sections, sections[0]!)).toBe(false);
    });

    it("matches Archive case-insensitively", () => {
        const sections = [
            section("archive", 0, 2),
            section("Terminals", 2, 3),
        ];
        expect(isArchivedSubsection(sections, sections[1]!)).toBe(true);
    });

    it("skips undefined-level ancestors (Default) when scanning backward", () => {
        // Default has no heading line, so it can never mask a real
        // level-<=2 ancestor found earlier in the scan.
        const sections = [
            section("Archive", 0, 2),
            section("Default", -1, undefined),
            section("Terminals", 2, 3),
        ];
        expect(isArchivedSubsection(sections, sections[2]!)).toBe(true);
    });
});
