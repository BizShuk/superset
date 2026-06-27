import { describe, it, expect } from "vitest";
import { computeTodoBadgeTitle } from "../src/todo/badge";

describe("computeTodoBadgeTitle", () => {
    it("returns the title unchanged when not filtering", () => {
        const title = computeTodoBadgeTitle("TODO", false, 5);
        expect(title).toBe("TODO");
    });

    it("returns the title unchanged when filtering but hidden count is 0", () => {
        const title = computeTodoBadgeTitle("TODO", true, 0);
        expect(title).toBe("TODO");
    });

    it("returns the title unchanged when filtering but hidden count is negative", () => {
        const title = computeTodoBadgeTitle("TODO", true, -1);
        expect(title).toBe("TODO");
    });

    it("appends hidden count when filtering with positive hidden count", () => {
        const title = computeTodoBadgeTitle("TODO", true, 3);
        expect(title).toBe("TODO  (已隱藏 3 個已完成)");
    });

    it("works with custom title prefix", () => {
        const title = computeTodoBadgeTitle("My Tasks", true, 1);
        expect(title).toBe("My Tasks  (已隱藏 1 個已完成)");
    });

    it("returns plain title when filtering off even if hidden count is positive", () => {
        const title = computeTodoBadgeTitle("TODO", false, 10);
        expect(title).toBe("TODO");
    });
});
