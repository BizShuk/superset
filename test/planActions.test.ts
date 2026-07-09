import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
    completePlan,
    backlogPlan,
    archivePlan,
    deletePlan,
    PlanActionError,
} from "../src/todo/planActions";

describe("planActions", () => {
    let tempRoot: string;

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), "plan-actions-"));
        mkdirSync(join(tempRoot, "plans"));
    });

    afterEach(() => {
        rmSync(tempRoot, { recursive: true, force: true });
    });

    function seedPlan(basename: string, body: string = "# Hello\n"): string {
        const filePath = join(tempRoot, "plans", basename);
        writeFileSync(filePath, body);
        return filePath;
    }

    describe("completePlan", () => {
        it("moves the file from plans/ to docs/specs/", async () => {
            seedPlan("2026-07-08-feature.md", "# Feature\n");
            await completePlan(tempRoot, "2026-07-08-feature.md");
            expect(existsSync(join(tempRoot, "plans", "2026-07-08-feature.md"))).toBe(false);
            expect(existsSync(join(tempRoot, "docs", "specs", "2026-07-08-feature.md"))).toBe(true);
        });

        it("creates docs/specs/ when missing", async () => {
            seedPlan("x.md");
            await completePlan(tempRoot, "x.md");
            expect(existsSync(join(tempRoot, "docs", "specs"))).toBe(true);
        });

        it("throws 'exists' when docs/specs/<f> already present", async () => {
            seedPlan("dup.md");
            mkdirSync(join(tempRoot, "docs", "specs"), { recursive: true });
            writeFileSync(join(tempRoot, "docs", "specs", "dup.md"), "# existing spec");
            await expect(completePlan(tempRoot, "dup.md")).rejects.toMatchObject({
                name: "PlanActionError",
                code: "exists",
            });
        });

        it("throws 'missing' when source plan does not exist", async () => {
            await expect(completePlan(tempRoot, "ghost.md")).rejects.toMatchObject({
                name: "PlanActionError",
                code: "missing",
            });
        });
    });

    describe("backlogPlan", () => {
        it("moves the file from plans/ to docs/backlog/", async () => {
            seedPlan("parking.md");
            await backlogPlan(tempRoot, "parking.md");
            expect(existsSync(join(tempRoot, "plans", "parking.md"))).toBe(false);
            expect(existsSync(join(tempRoot, "docs", "backlog", "parking.md"))).toBe(true);
        });

        it("creates docs/backlog/ when missing", async () => {
            seedPlan("y.md");
            await backlogPlan(tempRoot, "y.md");
            expect(existsSync(join(tempRoot, "docs", "backlog"))).toBe(true);
        });

        it("throws 'exists' on collision", async () => {
            seedPlan("clash.md");
            mkdirSync(join(tempRoot, "docs", "backlog"), { recursive: true });
            writeFileSync(join(tempRoot, "docs", "backlog", "clash.md"), "preexisting");
            await expect(backlogPlan(tempRoot, "clash.md")).rejects.toMatchObject({
                code: "exists",
            });
        });
    });

    describe("archivePlan", () => {
        it("moves the file from plans/ to plans/archive/", async () => {
            seedPlan("old.md");
            await archivePlan(tempRoot, "old.md");
            expect(existsSync(join(tempRoot, "plans", "old.md"))).toBe(false);
            expect(existsSync(join(tempRoot, "plans", "archive", "old.md"))).toBe(true);
        });

        it("creates plans/archive/ when missing", async () => {
            seedPlan("z.md");
            await archivePlan(tempRoot, "z.md");
            expect(existsSync(join(tempRoot, "plans", "archive"))).toBe(true);
        });

        it("throws 'exists' on collision", async () => {
            seedPlan("k.md");
            mkdirSync(join(tempRoot, "plans", "archive"));
            writeFileSync(join(tempRoot, "plans", "archive", "k.md"), "old");
            await expect(archivePlan(tempRoot, "k.md")).rejects.toMatchObject({
                code: "exists",
            });
        });
    });

    describe("deletePlan", () => {
        it("removes the file from plans/", async () => {
            seedPlan("trash.md");
            await deletePlan(tempRoot, "trash.md");
            expect(existsSync(join(tempRoot, "plans", "trash.md"))).toBe(false);
        });

        it("throws 'missing' when source plan does not exist", async () => {
            await expect(deletePlan(tempRoot, "ghost.md")).rejects.toMatchObject({
                name: "PlanActionError",
                code: "missing",
            });
        });

        it("does not touch sibling plans", async () => {
            seedPlan("keep.md", "# K");
            seedPlan("drop.md", "# D");
            await deletePlan(tempRoot, "drop.md");
            expect(existsSync(join(tempRoot, "plans", "keep.md"))).toBe(true);
            expect(existsSync(join(tempRoot, "plans", "drop.md"))).toBe(false);
        });
    });

    it("PlanActionError carries a code discriminator", async () => {
        seedPlan("a.md");
        try {
            await deletePlan(tempRoot, "nope.md");
            throw new Error("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(PlanActionError);
            expect((err as PlanActionError).code).toBe("missing");
            expect((err as PlanActionError).message).toContain("nope.md");
        }
    });
});