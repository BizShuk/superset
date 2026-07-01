// MdnsRegistry — coordinator over `MdnsStore` (state) +
// `MdnsExpirationSweeper` (timer) + `parser` (pure transforms).
// Owns the transport subscription, the coalesce debounce, and the
// listener fan-out. The public API is unchanged from the pre-refactor
// version, so the 23-case test suite covers this module verbatim.

import type { MdnsChange, MdnsListener, MdnsService } from "./types";
import type { MdnsPacket, MdnsTransport } from "./mdnsTransport";
import { MdnsStore } from "./store";
import { MdnsExpirationSweeper, type ClockSource } from "./expiration";
import {
    applyAddress,
    applyPtr,
    applySrv,
    applyTxt,
    createMutableService,
    freezeMutable,
} from "./parser";

export type { ClockSource };

const DEFAULT_CLOCK: ClockSource = { now: () => Date.now() };
const COALESCE_MS = 250;

/**
 * Pure data layer for mDNS service discovery.
 * Subscribes to an `MdnsTransport`, parses DNS-SD records, and exposes
 * discovered services via the observer pattern.
 *
 * No `vscode` imports — testable in plain Node.
 */
export class MdnsRegistry {
    private store: MdnsStore;
    private sweeper: MdnsExpirationSweeper;
    private listeners = new Set<MdnsListener>();
    private unsubscribeTransport?: () => void;
    private coalesceTimer?: ReturnType<typeof setTimeout>;
    private pending = new Map<string, MutableService>();
    private clock: ClockSource;

    constructor(
        private readonly transport: MdnsTransport,
        clock: ClockSource = DEFAULT_CLOCK
    ) {
        this.clock = clock;
        this.store = new MdnsStore();
        this.sweeper = new MdnsExpirationSweeper(
            this.store,
            (svc) => this.emit({ type: "expired", service: svc }),
            clock
        );
    }

    // ── Lifecycle ──────────────────────────────────────────

    start(): void {
        if (this.unsubscribeTransport) return;
        this.unsubscribeTransport = this.transport.onPacket((pkt) =>
            this.handlePacket(pkt)
        );
        this.transport.start();
        this.transport.browse();
        this.sweeper.start();
    }

    stop(): void {
        this.unsubscribeTransport?.();
        this.unsubscribeTransport = undefined;
        if (this.coalesceTimer) {
            clearTimeout(this.coalesceTimer);
            this.coalesceTimer = undefined;
        }
        this.sweeper.stop();
        this.transport.stop();
    }

    reset(): void {
        this.stop();
        this.store.clear();
        this.pending.clear();
        this.emit({ type: "reset" });
        this.start();
    }

    // ── Reads ──────────────────────────────────────────────

    getAll(): MdnsService[] {
        return this.store.getAll();
    }

    getByKey(key: string): MdnsService | undefined {
        return this.store.getByKey(key);
    }

    // ── Mutations ──────────────────────────────────────────

    /** Re-issue a browse query to discover services. */
    refresh(): void {
        this.transport.browse();
    }

    // ── Events ─────────────────────────────────────────────

    onDidChange(listener: MdnsListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    // ── Private: packet processing ─────────────────────────

    private handlePacket(pkt: MdnsPacket): void {
        const allRecords = [
            ...pkt.answers,
            ...(pkt.additionals ?? []),
        ];

        for (const r of allRecords) {
            if (r.type === "PTR") {
                this.handlePtr(r, pkt.srcAddress);
            } else if (r.type === "SRV") {
                this.handleSrv(r, pkt.srcAddress);
            } else if (r.type === "TXT") {
                this.handleTxt(r, pkt.srcAddress);
            } else if (r.type === "A" || r.type === "AAAA") {
                this.handleAddress(r);
            }
        }

        this.flushPending();
    }

    private handlePtr(
        r: { name: string; type: string; ttl: number; data: unknown },
        srcAddress?: string
    ): void {
        const data = r.data as string;
        if (typeof data !== "string") return;
        if (data === r.name) return; // skip self-referential
        const key = data;
        const pending = this.getPending(key, srcAddress);
        // Stamp the pending entry with the time the record arrived —
        // matches the pre-refactor behaviour where `lastSeen` reflects
        // packet time, not flush time.
        applyPtr(r, pending, this.clockNow());
    }

    private handleSrv(
        r: { name: string; type: string; ttl: number; data: unknown },
        srcAddress?: string
    ): void {
        const data = r.data as {
            port?: number;
            target?: string;
            priority?: number;
            weight?: number;
        };
        if (!data || typeof data.port !== "number") return;
        const key = r.name;
        const pending = this.getPending(key, srcAddress);
        applySrv(r, pending, this.clockNow());
    }

    private handleTxt(
        r: { name: string; type: string; ttl: number; data: unknown },
        srcAddress?: string
    ): void {
        const data = r.data as Record<string, string> | Buffer | undefined;
        if (!data) return;
        const key = r.name;
        const pending = this.getPending(key, srcAddress);
        applyTxt(r, pending, this.clockNow());
    }

    private handleAddress(
        r: { name: string; type: string; ttl: number; data: unknown }
    ): void {
        const data = r.data as string;
        if (typeof data !== "string") return;
        applyAddress(r, this.pending, this.clockNow());
    }

    private getPending(key: string, srcAddress?: string): MutableService {
        let p = this.pending.get(key);
        if (!p) {
            p = createMutableService();
            this.pending.set(key, p);
        } else if (srcAddress && !p.srcAddress) {
            p.srcAddress = srcAddress;
        }
        return p;
    }

    /**
     * Flush pending coalesced records after a 250ms debounce.
     * Multiple DNS records for the same service arrive in one UDP datagram;
     * we coalesce them into a single MdnsService before emitting.
     */
    private flushPending(): void {
        if (this.coalesceTimer) {
            clearTimeout(this.coalesceTimer);
        }
        this.coalesceTimer = setTimeout(() => {
            this.coalesceTimer = undefined;
            for (const [key, p] of this.pending) {
                if (!p.name || !p.type) continue;
                const service = freezeMutable(p);
                const result = this.store.upsert(key, service);
                this.emit({
                    type: result.kind === "added" ? "added" : "updated",
                    service: result.service,
                });
            }
            this.pending.clear();
        }, COALESCE_MS);
    }

    getDetailCached(
        svc: Pick<MdnsService, "name" | "type" | "host" | "port">
    ): { hit: boolean; detail: import("./mdnsTreeSpec").MdnsDetailField[] } {
        return this.store.getDetailCached(svc);
    }

    invalidateDetail(
        svc: Pick<MdnsService, "name" | "type" | "host" | "port">
    ): void {
        this.store.invalidateDetail(svc);
    }

    /**
     * Exposed for tests: the expiration sweep itself is in
     * `MdnsExpirationSweeper`; this is a thin pass-through.
     */
    expireStale(): void {
        this.sweeper.sweep();
    }

    private clockNow(): number {
        return this.clock.now();
    }

    private emit(change: MdnsChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }
}

// re-export the mutable service type for the existing tests / callers
import type { MutableService } from "./parser";
export type { MutableService } from "./parser";
