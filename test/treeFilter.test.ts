import { describe, it, expect } from "vitest";
import { matchesTerminal } from "../src/terminals/treeFilter";

describe("matchesTerminal", () => {
    const handle = { name: "build-server" };

    it("returns true when query is empty", () => {
        expect(matchesTerminal("", handle, "/Users/me/proj")).toBe(true);
    });

    it("matches against name case-insensitively", () => {
        expect(matchesTerminal("BUILD", handle, "/x")).toBe(true);
    });

    it("matches against cwd basename", () => {
        expect(matchesTerminal("proj", handle, "/Users/me/proj")).toBe(true);
    });

    it("matches against cwd full path", () => {
        expect(matchesTerminal("me/p", handle, "/Users/me/proj")).toBe(true);
    });

    it("returns false when nothing matches", () => {
        expect(matchesTerminal("nope", handle, "/x")).toBe(false);
    });
});
