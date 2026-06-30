import { describe, it, expect, vi } from "vitest";
import { DetailCache } from "../src/mdns/mdnsDetailCache";

describe("DetailCache", () => {
    it("returns miss then hit", () => {
        vi.useFakeTimers();
        const c = new DetailCache<string>(60_000);
        expect(c.get("k")).toEqual({ hit: false });
        c.set("k", "v");
        expect(c.get("k")).toEqual({ hit: true, value: "v" });
        vi.useRealTimers();
    });

    it("expires after TTL", () => {
        vi.useFakeTimers();
        const c = new DetailCache<string>(1000);
        c.set("k", "v");
        vi.advanceTimersByTime(1001);
        expect(c.get("k")).toEqual({ hit: false });
        vi.useRealTimers();
    });

    it("invalidate removes a single key", () => {
        const c = new DetailCache<string>(60_000);
        c.set("k1", "v1");
        c.set("k2", "v2");
        c.invalidate("k1");
        expect(c.get("k1").hit).toBe(false);
        expect(c.get("k2").hit).toBe(true);
    });
});
