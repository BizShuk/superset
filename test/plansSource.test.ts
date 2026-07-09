import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
    scanPlans,
    extractTitle,
    basenameFallback,
    planInfoToTodoItem,
    makePlansSection,
    formatPlanCopyText,
    PLANS_DIR_NAME,
} from "../src/todo/plansSource";

describe("plansSource", () => {
    let tempRoot: string;

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), "plans-source-"));
    });

    afterEach(() => {
        rmSync(tempRoot, { recursive: true, force: true });
    });

    describe("scanPlans", () => {
        it("returns [] when plans/ directory does not exist", async () => {
            const result = await scanPlans(tempRoot);
            expect(result).toEqual([]);
        });

        it("returns [] when plans/ exists but is empty", async () => {
            mkdirSync(join(tempRoot, PLANS_DIR_NAME));
            const result = await scanPlans(tempRoot);
            expect(result).toEqual([]);
        });

        it("skips non-.md files and counts only markdown", async () => {
            const dir = join(tempRoot, PLANS_DIR_NAME);
            mkdirSync(dir);
            writeFileSync(join(dir, "keep.md"), "# Keep");
            writeFileSync(join(dir, "skip.txt"), "ignored");
            writeFileSync(join(dir, "backup.md.bak"), "ignored");
            writeFileSync(join(dir, "lower.MD"), "# Case");
            const result = await scanPlans(tempRoot);
            // Both .md and .MD should be picked up (.toLowerCase() comparison).
            expect(result.map((p) => p.basename).sort()).toEqual(["keep.md", "lower.MD"]);
        });

        it("sorts results by basename (date-prefixed files first)", async () => {
            const dir = join(tempRoot, PLANS_DIR_NAME);
            mkdirSync(dir);
            // Insert in a non-sorted order to confirm the sort happens.
            writeFileSync(join(dir, "architecture-foo.md"), "# Arch");
            writeFileSync(join(dir, "2026-07-08-feature.md"), "# F");
            writeFileSync(join(dir, "2026-06-23-chore.md"), "# C");
            const result = await scanPlans(tempRoot);
            // digits come before letters in localeCompare — date prefix first
            expect(result.map((p) => p.basename)).toEqual([
                "2026-06-23-chore.md",
                "2026-07-08-feature.md",
                "architecture-foo.md",
            ]);
        });

        it("returns correct count and includes filePath + mtimeMs", async () => {
            const dir = join(tempRoot, PLANS_DIR_NAME);
            mkdirSync(dir);
            writeFileSync(join(dir, "a.md"), "# A");
            writeFileSync(join(dir, "b.md"), "# B");
            const result = await scanPlans(tempRoot);
            expect(result).toHaveLength(2);
            for (const plan of result) {
                expect(plan.filePath.startsWith(dir)).toBe(true);
                expect(plan.basename.endsWith(".md")).toBe(true);
                expect(typeof plan.mtimeMs).toBe("number");
                expect(plan.mtimeMs).toBeGreaterThan(0);
            }
        });
    });

    describe("extractTitle", () => {
        it("returns the first H1 heading", async () => {
            const dir = join(tempRoot, PLANS_DIR_NAME);
            mkdirSync(dir);
            const file = join(dir, "test.md");
            writeFileSync(
                file,
                "# Hello World\n\nSome intro paragraph.\n"
            );
            const title = await extractTitle(file, "test.md");
            expect(title).toBe("Hello World");
        });

        it("falls back to humanised basename when no H1 exists", async () => {
            const dir = join(tempRoot, PLANS_DIR_NAME);
            mkdirSync(dir);
            const file = join(dir, "2026-07-08-chore-foo.md");
            writeFileSync(file, "no heading here\njust text\n");
            const title = await extractTitle(file, "2026-07-08-chore-foo.md");
            expect(title).toBe("Chore Foo");
        });

        it("finds H1 even if it appears after a few blank lines", async () => {
            const dir = join(tempRoot, PLANS_DIR_NAME);
            mkdirSync(dir);
            const file = join(dir, "x.md");
            writeFileSync(file, "\n\n\n\n# Late Heading\n\nbody\n");
            const title = await extractTitle(file, "x.md");
            expect(title).toBe("Late Heading");
        });

        it("falls back to basename when file does not exist", async () => {
            const dir = join(tempRoot, PLANS_DIR_NAME);
            mkdirSync(dir);
            const title = await extractTitle(
                join(dir, "2026-07-08-missing.md"),
                "2026-07-08-missing.md"
            );
            expect(title).toBe("Missing");
        });
    });

    describe("basenameFallback", () => {
        it("strips .md extension and date prefix", () => {
            expect(basenameFallback("2026-07-08-feature-foo.md")).toBe("Feature Foo");
        });

        it("title-cases every word", () => {
            expect(basenameFallback("architecture-foo-bar.md")).toBe("Architecture Foo Bar");
        });

        it("handles non-dated basenames", () => {
            expect(basenameFallback("2026-07-08-chore-x.md")).toBe("Chore X");
        });
    });

    describe("planInfoToTodoItem", () => {
        it("produces a kind:'plan' item with the right fields", () => {
            const item = planInfoToTodoItem({
                basename: "2026-07-08-foo.md",
                title: "Foo Title",
                filePath: "/tmp/plans/2026-07-08-foo.md",
                mtimeMs: 12345,
            });
            expect(item.kind).toBe("plan");
            expect(item.text).toBe("Foo Title"); // H1 title as the main row text
            expect(item.description).toBe("2026-07-08-foo"); // basename sans .md as secondary
            expect(item.filePath).toBe("/tmp/plans/2026-07-08-foo.md");
            expect(item.checked).toBe(false);
            expect(item.children).toEqual([]);
            expect(item.parentSection).toBe("Plans");
        });

        it("returns checked:false (never toggleable)", () => {
            const item = planInfoToTodoItem({
                basename: "x.md",
                title: "X",
                filePath: "/p/x.md",
                mtimeMs: 0,
            });
            expect(item.checked).toBe(false);
        });
    });

    describe("makePlansSection", () => {
        it("builds a synthetic section with kind:'section' and undefined level", () => {
            const items = [
                planInfoToTodoItem({
                    basename: "a.md",
                    title: "A",
                    filePath: "/p/a.md",
                    mtimeMs: 0,
                }),
            ];
            const section = makePlansSection(items);
            expect(section.kind).toBe("section");
            expect(section.text).toBe("Plans");
            expect(section.level).toBeUndefined();
            expect(section.children).toEqual(items);
            expect(section.description).toContain("plans");
        });
    });

    describe("formatPlanCopyText", () => {
        it("formats a plan row as [title](file://...) markdown link", () => {
            const item = planInfoToTodoItem({
                basename: "2026-07-08-foo.md",
                title: "Foo Title",
                filePath: "/tmp/plans/2026-07-08-foo.md",
                mtimeMs: 0,
            });
            const out = formatPlanCopyText(item);
            expect(out).toBe("[Foo Title](file:///tmp/plans/2026-07-08-foo.md)");
        });

        it("percent-encodes spaces and special chars in the path", () => {
            const item = planInfoToTodoItem({
                basename: "x.md",
                title: "X",
                filePath: "/tmp/with space/and#hash.md",
                mtimeMs: 0,
            });
            const out = formatPlanCopyText(item);
            expect(out).toBe("[X](file:///tmp/with%20space/and%23hash.md)");
        });

        it("returns null for non-plan items", () => {
            expect(
                formatPlanCopyText({
                    kind: "checkbox",
                    line: 0,
                    text: "foo",
                    checked: false,
                }),
            ).toBeNull();
        });

        it("returns null when filePath is missing on a plan item", () => {
            expect(
                formatPlanCopyText({
                    kind: "plan",
                    line: 0,
                    text: "no path",
                    checked: false,
                    filePath: undefined,
                }),
            ).toBeNull();
        });
    });
});