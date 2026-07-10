// Pure-function tests for the todoEngine link helpers.
// `extractLink` and `formatLinkCopyText` are the dual inputs to the
// shared `Copy` command: the factory uses `formatLinkCopyText` to
// decide whether to render two lines (label + link target) for
// `*WithLink` rows. Keeping the helper pure makes the contract
// "no link → return null, caller falls back to plain text" easy
// to assert in isolation, without having to mock the vscode
// clipboard surface.

import { describe, expect, it } from "vitest";
import { extractLink, formatLinkCopyText } from "../../src/todoEngine/linkUtils";

describe("extractLink", () => {
    it("returns the target of a markdown [text](url) link", () => {
        expect(extractLink("[Open](https://example.com)")).toBe(
            "https://example.com"
        );
    });

    it("returns the first markdown link target when multiple are present", () => {
        expect(
            extractLink("[first](https://a.example) and [second](https://b.example)")
        ).toBe("https://a.example");
    });

    it("returns a raw https URL when no markdown wrapper is present", () => {
        expect(extractLink("see https://example.com for details")).toBe(
            "https://example.com"
        );
    });

    it("returns null when the text contains no link", () => {
        expect(extractLink("just a plain label")).toBeNull();
    });

    it("returns null for an empty string", () => {
        expect(extractLink("")).toBeNull();
    });
});

describe("formatLinkCopyText", () => {
    it("returns null for plain checkbox rows (no link-bearing kind)", () => {
        expect(
            formatLinkCopyText({ kind: "checkbox", text: "fix bug" })
        ).toBeNull();
    });

    it("returns null for plain list rows", () => {
        expect(
            formatLinkCopyText({ kind: "list", text: "free note" })
        ).toBeNull();
    });

    it("returns null for section / plan / project rows", () => {
        expect(
            formatLinkCopyText({ kind: "section", text: "## Misc" })
        ).toBeNull();
        expect(
            formatLinkCopyText({ kind: "plan", text: "design doc" })
        ).toBeNull();
        expect(
            formatLinkCopyText({ kind: "project", text: "superset" })
        ).toBeNull();
    });

    it("returns label + target for checkboxWithLink rows", () => {
        const result = formatLinkCopyText({
            kind: "checkboxWithLink",
            text: "[Open foo](https://foo.example/path?q=1)",
        });
        expect(result).toBe(
            "[Open foo](https://foo.example/path?q=1)\nhttps://foo.example/path?q=1"
        );
    });

    it("returns label + target for listWithLink rows", () => {
        const result = formatLinkCopyText({
            kind: "listWithLink",
            text: "[Doc](https://doc.example)",
        });
        expect(result).toBe("[Doc](https://doc.example)\nhttps://doc.example");
    });

    it("treats `*WithLinkArchived` variants as link-bearing (archive is visual only)", () => {
        const result = formatLinkCopyText({
            kind: "checkboxWithLinkArchived",
            text: "[done](https://x.example)",
        });
        expect(result).toBe("[done](https://x.example)\nhttps://x.example");

        const listArchived = formatLinkCopyText({
            kind: "listWithLinkArchived",
            text: "[note](https://y.example)",
        });
        expect(listArchived).toBe(
            "[note](https://y.example)\nhttps://y.example"
        );
    });

    it("preserves raw https URLs in the label on line 1", () => {
        const result = formatLinkCopyText({
            kind: "checkboxWithLink",
            text: "see https://example.com for context",
        });
        expect(result).toBe(
            "see https://example.com for context\nhttps://example.com"
        );
    });

    it("falls back to the raw label as line 2 when no link is extractable", () => {
        // The row claims `*WithLink` but the text has no `https?://`
        // and no `[..](..)` shape. We still want to copy *something*
        // for the second line so the user doesn't silently lose the
        // payload — better to repeat the label than to emit an empty
        // line that confuses the paste target.
        const result = formatLinkCopyText({
            kind: "checkboxWithLink",
            text: "broken link row",
        });
        expect(result).toBe("broken link row\nbroken link row");
    });

    it("does not double-decode markdown targets", () => {
        // extractLink returns the raw `[^)]+` group, so a percent-encoded
        // URL stays percent-encoded on line 2 — mirrors the plan path's
        // `filePath` behavior of returning the path verbatim.
        const result = formatLinkCopyText({
            kind: "checkboxWithLink",
            text: "[Doc](https://example.com/a%20b)",
        });
        expect(result).toBe(
            "[Doc](https://example.com/a%20b)\nhttps://example.com/a%20b"
        );
    });
});
