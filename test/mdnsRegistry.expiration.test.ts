import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MdnsRegistry } from "../src/mdnsRegistry";
import type { MdnsPacket, MdnsTransport } from "../src/mdnsTransport";

/**
 * Expiration-path tests for MdnsRegistry. Kept in a dedicated file because the
 * main mdnsRegistry.test.ts would otherwise exceed ~400 lines.
 *
 * Time is fully controlled: `vi.useFakeTimers()` drives the coalesce debounce
 * (250 ms) and the expiry interval (EXPIRY_TICK_MS), while an injected
 * `{ now: () => fakeNow }` clock controls `lastSeen` / grace-period math.
 */

// Mirror of the registry's tuning constants (see mdnsRegistry.ts).
const TTL_GRACE_MULTIPLIER = 3;
const EXPIRY_TICK_MS = 5_000;
const TTL_DEFAULT_SECONDS = 120;

class FakeMdnsTransport implements MdnsTransport {
    private listeners: Array<(pkt: MdnsPacket) => void> = [];

    start(): void {}
    stop(): void {}
    browse(): void {}
    onPacket(cb: (pkt: MdnsPacket) => void): () => void {
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== cb);
        };
    }
    feed(pkt: MdnsPacket): void {
        for (const cb of this.listeners) cb(pkt);
    }
}

function feedService(
    transport: FakeMdnsTransport,
    name: string,
    opts: { ttl?: number; port?: number; host?: string } = {}
): void {
    const ttl = opts.ttl ?? 120;
    const port = opts.port ?? 80;
    const host = opts.host ?? `${name.toLowerCase()}.local`;
    const type = "_http._tcp";
    transport.feed({
        answers: [
            { name: `${type}.local`, type: "PTR", ttl, data: `${name}.${type}.local` },
            { name: `${name}.${type}.local`, type: "SRV", ttl, data: { port, target: host } },
            { name: host, type: "A", ttl, data: "10.0.0.1" },
        ],
    });
}

describe("MdnsRegistry expiration", () => {
    let fakeNow: number;
    let transport: FakeMdnsTransport;
    let registry: MdnsRegistry;

    beforeEach(() => {
        vi.useFakeTimers();
        fakeNow = 0;
        transport = new FakeMdnsTransport();
        registry = new MdnsRegistry(transport, { now: () => fakeNow });
        registry.start();
    });

    afterEach(() => {
        registry.stop();
        vi.useRealTimers();
    });

    /** Fire the 250 ms coalesce debounce so pending records commit. */
    function flush(): void {
        vi.advanceTimersByTime(250);
    }
    /** Fire one expiry scan (the 5 s interval). */
    function tickExpiry(): void {
        vi.advanceTimersByTime(EXPIRY_TICK_MS);
    }
    /** Advance the injected clock (lastSeen / grace math) by `ms`. */
    function advance(ms: number): void {
        fakeNow += ms;
    }
    function expiredCalls(listener: ReturnType<typeof vi.fn>) {
        return listener.mock.calls.filter((c) => c[0].type === "expired");
    }

    it("does not expire a service still within its grace period", () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        feedService(transport, "Svc", { ttl: 120 }); // grace = 360_000 ms
        flush();

        advance(100_000); // well within grace
        tickExpiry();

        expect(registry.getAll()).toHaveLength(1);
        expect(expiredCalls(listener)).toHaveLength(0);
    });

    it("expires a service past 3× TTL with no new packets, emitting 'expired'", () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        feedService(transport, "Svc", { ttl: 120 }); // grace = 360_000 ms
        flush();

        advance(360_001); // one ms past grace
        tickExpiry();

        expect(registry.getAll()).toHaveLength(0);
        const expired = expiredCalls(listener);
        expect(expired).toHaveLength(1);
        expect(expired[0][0].service.name).toBe("Svc._http._tcp.local");
    });

    it("falls back to the default TTL when the service advertises ttl 0", () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        feedService(transport, "Svc", { ttl: 0 }); // grace = 120 * 3 * 1000 = 360_000 ms
        flush();

        // Just under the default grace → still alive.
        advance(359_000);
        tickExpiry();
        expect(registry.getAll()).toHaveLength(1);
        expect(expiredCalls(listener)).toHaveLength(0);

        // Past the default grace → expired.
        advance(2_000); // total 361_000
        tickExpiry();
        expect(registry.getAll()).toHaveLength(0);
        expect(expiredCalls(listener)).toHaveLength(1);
    });

    it("expires only stale services, leaving fresh ones", () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        feedService(transport, "Stale", { ttl: 120, port: 80, host: "stale.local" });
        flush(); // lastSeen = 0

        advance(200_000);
        feedService(transport, "Fresh", { ttl: 120, port: 81, host: "fresh.local" });
        flush(); // lastSeen = 200_000

        advance(200_000); // now = 400_000
        tickExpiry();
        // Stale: 400_000 - 0 > 360_000 → expired
        // Fresh: 400_000 - 200_000 = 200_000 < 360_000 → alive

        const remaining = registry.getAll().map((s) => s.name);
        expect(remaining).toContain("Fresh._http._tcp.local");
        expect(remaining).not.toContain("Stale._http._tcp.local");

        const expired = expiredCalls(listener);
        expect(expired).toHaveLength(1);
        expect(expired[0][0].service.name).toBe("Stale._http._tcp.local");
    });

    it("coalesces multiple simultaneous expirations, emitting each exactly once", () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        feedService(transport, "A", { port: 80, host: "a.local" });
        flush();
        feedService(transport, "B", { port: 80, host: "b.local" });
        flush();
        feedService(transport, "C", { port: 80, host: "c.local" });
        flush();

        advance(360_001);
        tickExpiry();

        expect(registry.getAll()).toHaveLength(0);
        const expired = expiredCalls(listener);
        expect(expired).toHaveLength(3);
        expect(expired.map((c) => c[0].service.name).sort()).toEqual([
            "A._http._tcp.local",
            "B._http._tcp.local",
            "C._http._tcp.local",
        ]);

        // A second scan must not re-emit for already-removed services.
        tickExpiry();
        expect(expiredCalls(listener)).toHaveLength(3);
    });

    it("clears the expiry timer on stop()", () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        feedService(transport, "Svc", { ttl: 120 });
        flush();

        registry.stop();
        advance(360_001);
        tickExpiry(); // interval cleared → no scan

        expect(registry.getAll()).toHaveLength(1);
        expect(expiredCalls(listener)).toHaveLength(0);
    });

    it("a fresh packet within grace resets lastSeen and prevents expiry", () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        feedService(transport, "A", { ttl: 120, port: 80, host: "a.local" });
        flush(); // lastSeen = 0

        advance(300_000); // < 360_000 grace, still alive
        tickExpiry();
        expect(registry.getAll()).toHaveLength(1);

        // Refresh: a new packet bumps lastSeen to 300_000.
        feedService(transport, "A", { ttl: 120, port: 80, host: "a.local" });
        flush();

        // Advance past the ORIGINAL grace (600_000 > 360_000). Without the
        // refresh this would expire; with it, lastSeen=300_000 → 300_000 < grace.
        advance(300_000); // now = 600_000
        tickExpiry();

        expect(registry.getAll()).toHaveLength(1);
        expect(expiredCalls(listener)).toHaveLength(0);
    });

    it("respects a shorter TTL with a proportionally shorter grace", () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        feedService(transport, "Short", { ttl: 10 }); // grace = 10 * 3 * 1000 = 30_000 ms
        flush();

        advance(30_001);
        tickExpiry();

        expect(registry.getAll()).toHaveLength(0);
        expect(expiredCalls(listener)).toHaveLength(1);
    });
});
