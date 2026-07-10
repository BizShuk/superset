import { describe, expect, it } from "vitest";
import {
    findFirstMermaidMatch,
    findAllMermaidMatches,
} from "../src/mermaid/mermaidTrigger";

describe("findFirstMermaidMatch", () => {
    it("returns null when buffer has no trigger line", () => {
        const buf = [
            "graph TD",
            "  A --> B",
            "",
            "echo hello",
        ];
        expect(findFirstMermaidMatch(buf)).toBeNull();
    });

    it("matches a standalone 'mermaid' line and walks body until empty", () => {
        const buf = [
            "some prior output",
            "mermaid",
            "graph TD",
            "  A --> B",
            "", // terminator
            "subsequent output",
        ];
        const m = findFirstMermaidMatch(buf);
        expect(m).not.toBeNull();
        expect(m!.triggerLine).toBe(1);
        expect(m!.bodyLines).toEqual([2, 3]);
        expect(m!.bodyText).toBe("graph TD\n  A --> B");
        expect(m!.triggerRange).toEqual({ start: 0, end: 7 });
    });

    it("is case-insensitive on the trigger keyword", () => {
        const buf = ["Mermaid", "graph LR", "  X --> Y"];
        const m = findFirstMermaidMatch(buf);
        expect(m).not.toBeNull();
        expect(m!.triggerLine).toBe(0);
        expect(m!.triggerRange).toEqual({ start: 0, end: 7 });
    });

    it("uses body until end-of-buffer when no terminator appears", () => {
        const buf = ["mermaid", "graph TD", "  A --> B", "  C --> D"];
        const m = findFirstMermaidMatch(buf);
        expect(m).not.toBeNull();
        expect(m!.bodyLines).toEqual([1, 2, 3]);
        expect(m!.bodyText).toBe("graph TD\n  A --> B\n  C --> D");
    });

    it("returns zero-length body when trigger is followed by empty line", () => {
        const buf = ["mermaid", "", "more output"];
        const m = findFirstMermaidMatch(buf);
        expect(m).not.toBeNull();
        expect(m!.bodyLines).toEqual([]);
        expect(m!.bodyText).toBe("");
    });

    it("respects fromIndex cursor (no double-fire)", () => {
        const buf = ["mermaid", "graph TD", "  A --> B", ""];
        const first = findFirstMermaidMatch(buf, 0);
        expect(first).not.toBeNull();
        const second = findFirstMermaidMatch(buf, first!.bodyLines.at(-1)! + 1);
        expect(second).toBeNull();
    });

    it("does not trigger when 'mermaid' is embedded in prose", () => {
        const buf = [
            "echo this is a mermaid syntax demo",
            "graph TD",
            "  A --> B",
        ];
        expect(findFirstMermaidMatch(buf)).toBeNull();
    });

    it("treats whitespace-only line as a terminator", () => {
        const buf = ["mermaid", "graph TD", "   ", "tail"];
        const m = findFirstMermaidMatch(buf);
        expect(m).not.toBeNull();
        expect(m!.bodyLines).toEqual([1]);
        expect(m!.bodyText).toBe("graph TD");
    });

    it("computes triggerRange accounting for leading indent", () => {
        const buf = ["   mermaid", "graph TD"];
        const m = findFirstMermaidMatch(buf);
        expect(m).not.toBeNull();
        expect(m!.triggerRange).toEqual({ start: 3, end: 10 });
    });
});

describe("findAllMermaidMatches", () => {
    it("collects every non-overlapping match in a buffer", () => {
        const buf = [
            "mermaid",
            "graph TD",
            "  A --> B",
            "",
            "echo done",
            "mermaid",
            "graph LR",
            "  X --> Y",
        ];
        const matches = findAllMermaidMatches(buf);
        expect(matches).toHaveLength(2);
        expect(matches[0]!.triggerLine).toBe(0);
        expect(matches[1]!.triggerLine).toBe(5);
    });

    it("skips 'mermaid' keywords that appear inside a body", () => {
        const buf = [
            "mermaid",
            "graph TD",
            "  A[\"mermaid inside\"] --> B",
            "",
            "tail",
        ];
        const matches = findAllMermaidMatches(buf);
        expect(matches).toHaveLength(1);
        expect(matches[0]!.bodyText).toBe(
            'graph TD\n  A["mermaid inside"] --> B'
        );
    });

    it("returns empty array when no triggers exist", () => {
        expect(findAllMermaidMatches([])).toEqual([]);
        expect(findAllMermaidMatches(["just text", "no trigger here"])).toEqual(
            []
        );
    });
});
