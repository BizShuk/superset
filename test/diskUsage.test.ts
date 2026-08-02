// diskUsage — pure capacity math and Status Bar rendering.

import { describe, expect, it } from "vitest";
import {
    calculateDiskUsage,
    renderDiskUsage,
    renderDiskUsageError,
} from "../src/diskUsage/usage";

describe("calculateDiskUsage", () => {
    it("uses available blocks and rounds the used percentage", () => {
        const usage = calculateDiskUsage({
            bsize: 1024,
            blocks: 100,
            bfree: 30,
            bavail: 25,
        });

        expect(usage).toEqual({
            totalBytes: 102_400,
            freeBytes: 25_600,
            usedBytes: 76_800,
            usedPercent: 75,
        });
    });

    it("accepts bigint statfs values and handles an empty filesystem", () => {
        expect(
            calculateDiskUsage({
                bsize: 4096n,
                blocks: 10n,
                bfree: 2n,
                bavail: 2n,
            }).usedPercent
        ).toBe(80);
        expect(
            calculateDiskUsage({ bsize: 4096, blocks: 0, bfree: 0 }).usedPercent
        ).toBe(0);
    });

    it("clamps malformed free capacity to the total", () => {
        expect(
            calculateDiskUsage({
                bsize: 1024,
                blocks: 10,
                bfree: 100,
                bavail: 100,
            })
        ).toEqual({
            totalBytes: 10_240,
            freeBytes: 10_240,
            usedBytes: 0,
            usedPercent: 0,
        });
    });
});

describe("renderDiskUsage", () => {
    it("keeps the Status Bar compact and the tooltip detailed", () => {
        const render = renderDiskUsage("/workspace", {
            totalBytes: 10 * 1024 ** 3,
            freeBytes: 2 * 1024 ** 3,
            usedBytes: 8 * 1024 ** 3,
            usedPercent: 80,
        });

        expect(render.text).toBe("$(database) Disk 80%");
        expect(render.tooltip).toContain("Disk usage for /workspace");
        expect(render.tooltip).toContain("Used: 8.00 GiB / 10.0 GiB");
        expect(render.tooltip).toContain("Free: 2.00 GiB");
        expect(render.tooltip).toContain("Updates every 30 seconds.");
    });
});

describe("renderDiskUsageError", () => {
    it("makes statfs failures visible without throwing", () => {
        const render = renderDiskUsageError("/workspace", new Error("EACCES"));
        expect(render.text).toBe("$(database) Disk —");
        expect(render.tooltip).toContain("Disk usage unavailable for /workspace");
        expect(render.tooltip).toContain("EACCES");
    });
});
