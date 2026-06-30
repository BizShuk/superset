import { describe, it, expect } from "vitest";
import { buildQuickPickItems, scoreMatch } from "../src/terminals/jumpToTerminal";

const terms = [
    { name: "build-server", pid: 1234 },
    { name: "test-runner", pid: 5678 },
] as any;

describe("scoreMatch", () => {
    it("scores prefix match higher than substring", () => {
        const a = scoreMatch("build", terms[0]);
        const b = scoreMatch("server", terms[0]);
        expect(a).toBeGreaterThan(b);
    });
    it("returns 0 for no match", () => {
        expect(scoreMatch("nope", terms[0])).toBe(0);
    });
    it("scores pid match correctly", () => {
        const score = scoreMatch("123", terms[0]);
        expect(score).toBe(70);
    });
    it("scores cwd match via matchesTerminal", () => {
        const termWithCwd = { name: "terminal-1", cwd: "/Users/me/project-abc" };
        const score = scoreMatch("project-abc", termWithCwd);
        expect(score).toBe(30);
    });
});

describe("buildQuickPickItems", () => {
    it("filters and sorts by score desc", () => {
        const items = buildQuickPickItems(terms, "build");
        expect(items[0].label).toBe("build-server");
    });
    it("returns empty when no match", () => {
        expect(buildQuickPickItems(terms, "zzz")).toEqual([]);
    });
});
