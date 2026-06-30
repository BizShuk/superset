import type { MdnsChange, MdnsListener, MdnsService } from "./types";
import type { MdnsPacket, MdnsTransport } from "./mdnsTransport";
import { networkKey, mergeServices } from "./mdnsDedup";
import { DetailCache } from "./mdnsDetailCache";
import { buildMdnsDetailFields, type MdnsDetailField } from "./mdnsTreeSpec";

/** Injectable clock so tests can control `lastSeen` / grace-period math. */
export interface ClockSource {
    now(): number;
}

/** Grace period as a multiple of a service's TTL (RFC 6762 §10.1 cache-flush). */
export const TTL_GRACE_MULTIPLIER = 3;
/** How often the expiry sweep runs. */
export const EXPIRY_TICK_MS = 5_000;
/** TTL (seconds) assumed when a record arrives without one. */
export const TTL_DEFAULT_SECONDS = 120;

const DEFAULT_CLOCK: ClockSource = { now: () => Date.now() };

/** Mutable internal representation for coalescing DNS records. */
interface MutableService {
    name: string;
    type: string;
    domain: string;
    port: number;
    priority: number;
    weight: number;
    ttl: number;
    host?: string;
    addresses: string[];
    txt: Record<string, string>;
    subtypes: string[];
    srcAddress?: string;
    firstSeen: number;
    lastSeen: number;
}

/** Track the minimum TTL across all records for a service. */
function trackMinTtl(current: number, incoming: number): number {
    if (current === 0) return incoming;
    return Math.min(current, incoming);
}

/**
 * Extract the subtype from a PTR name like "_printer._sub._http._tcp".
 * Returns the subtype string (e.g. "_printer") or undefined.
 */
function extractSubtype(typeName: string): string | undefined {
    const parts = typeName.split(".");
    const subIdx = parts.indexOf("_sub");
    if (subIdx <= 0) return undefined;
    const subtype = parts[subIdx - 1];
    return subtype.startsWith("_") ? subtype : undefined;
}

/**
 * Strip the subtype segment from a type name.
 * "_printer._sub._http._tcp" → "_http._tcp"
 */
function stripSubtype(typeName: string): string {
    const parts = typeName.split(".");
    const subIdx = parts.indexOf("_sub");
    if (subIdx <= 0) return typeName;
    return parts.slice(subIdx + 1).join(".");
}

function freeze(s: MutableService): MdnsService {
    return {
        name: s.name,
        type: s.type,
        domain: s.domain,
        port: s.port,
        priority: s.priority,
        weight: s.weight,
        ttl: s.ttl,
        host: s.host,
        addresses: s.addresses.slice(),
        txt: { ...s.txt },
        subtypes: s.subtypes.slice(),
        srcAddress: s.srcAddress,
        firstSeen: s.firstSeen,
        lastSeen: s.lastSeen,
    };
}

/**
 * Pure data layer for mDNS service discovery.
 * Subscribes to an `MdnsTransport`, parses DNS-SD records, and exposes
 * discovered services via the observer pattern.
 *
 * No `vscode` imports — testable in plain Node.
 */
export class MdnsRegistry {
    private services = new Map<string, MdnsService>();
    private listeners = new Set<MdnsListener>();
    private unsubscribeTransport?: () => void;
    private coalesceTimer?: ReturnType<typeof setTimeout>;
    private pending = new Map<string, MutableService>();
    /**
     * Secondary index: network identity (`host|port|type`) → canonical
     * services-key (the first-seen instance name). Lets two instance names
     * that resolve to the same network endpoint collapse into one row.
     */
    private byNetworkKey = new Map<string, string>();
    /** Reverse of `byNetworkKey`: canonical key → its current network key. */
    private canonKeyToNk = new Map<string, string>();
    /** Periodic sweep that removes services past their TTL grace period. */
    private expiryTimer?: ReturnType<typeof setInterval>;
    private readonly detailCache = new DetailCache<readonly MdnsDetailField[]>(60_000);

    constructor(
        private readonly transport: MdnsTransport,
        private readonly clock: ClockSource = DEFAULT_CLOCK
    ) {}

    // ── Lifecycle ──────────────────────────────────────────

    start(): void {
        if (this.unsubscribeTransport) return;
        this.unsubscribeTransport = this.transport.onPacket((pkt) =>
            this.handlePacket(pkt)
        );
        this.transport.start();
        this.transport.browse();
        this.expiryTimer = setInterval(
            () => this.expireStale(),
            EXPIRY_TICK_MS
        );
    }

    stop(): void {
        this.unsubscribeTransport?.();
        this.unsubscribeTransport = undefined;
        if (this.coalesceTimer) {
            clearTimeout(this.coalesceTimer);
            this.coalesceTimer = undefined;
        }
        if (this.expiryTimer) {
            clearInterval(this.expiryTimer);
            this.expiryTimer = undefined;
        }
        this.transport.stop();
    }

    // ── Reads ──────────────────────────────────────────────

    getAll(): MdnsService[] {
        return Array.from(this.services.values());
    }

    getByKey(key: string): MdnsService | undefined {
        return this.services.get(key);
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
                this.handleAddress(r, pkt.srcAddress);
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

        // r.name is the service type (e.g. "_http._tcp.local" or "_printer._sub._http._tcp.local")
        // data is the instance name (e.g. "MyPrinter._http._tcp.local")
        if (data === r.name) return; // skip self-referential

        const key = data; // instance name is the key
        const pending = this.getPending(key, srcAddress);
        if (!pending.name) {
            pending.name = data;
            // Strip .local suffix and extract subtype from PTR name
            const basename = r.name.replace(/\.local\.?$/i, "");
            const subtype = extractSubtype(basename);
            if (subtype) {
                pending.type = stripSubtype(basename);
                if (!pending.subtypes.includes(subtype)) {
                    pending.subtypes = [...pending.subtypes, subtype];
                }
            } else {
                pending.type = basename;
            }
            pending.domain = "local";
        }
        pending.ttl = trackMinTtl(pending.ttl, r.ttl);
        pending.firstSeen = pending.firstSeen || this.clock.now();
        pending.lastSeen = this.clock.now();
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
        pending.port = data.port;
        pending.priority = data.priority ?? 0;
        pending.weight = data.weight ?? 0;
        if (data.target) {
            pending.host = data.target.replace(/\.$/i, "");
        }
        pending.ttl = trackMinTtl(pending.ttl, r.ttl);
        pending.firstSeen = pending.firstSeen || this.clock.now();
        pending.lastSeen = this.clock.now();
    }

    private handleTxt(
        r: { name: string; type: string; ttl: number; data: unknown },
        srcAddress?: string
    ): void {
        const data = r.data as Record<string, string> | Buffer | undefined;
        if (!data) return;

        const key = r.name;
        const pending = this.getPending(key, srcAddress);

        let txt: Record<string, string> = {};
        if (Buffer.isBuffer(data)) {
            // Buffer of key=value pairs separated by a length byte
            let off = 0;
            while (off < data.length) {
                const len = data[off];
                if (len === 0) break;
                const str = data.slice(off + 1, off + 1 + len).toString("utf-8");
                const eq = str.indexOf("=");
                if (eq > 0) {
                    txt[str.slice(0, eq)] = str.slice(eq + 1);
                }
                off += 1 + len;
            }
        } else {
            txt = data;
        }
        pending.txt = { ...(pending.txt ?? {}), ...txt };
        pending.ttl = trackMinTtl(pending.ttl, r.ttl);
        pending.firstSeen = pending.firstSeen || this.clock.now();
        pending.lastSeen = this.clock.now();
    }

    private handleAddress(
        r: { name: string; type: string; ttl: number; data: unknown },
        srcAddress?: string
    ): void {
        const data = r.data as string;
        if (typeof data !== "string") return;

        const addr = data;
        const hostname = r.name.replace(/\.$/i, "");

        // Add address to the hostname entry itself
        const self = this.getPending(hostname, srcAddress);
        const selfAddrs = self.addresses ?? [];
        if (!selfAddrs.includes(addr)) {
            self.addresses = [...selfAddrs, addr];
        }
        self.ttl = trackMinTtl(self.ttl, r.ttl);
        self.firstSeen = self.firstSeen || this.clock.now();
        self.lastSeen = this.clock.now();

        // Also add to any service whose host matches this hostname
        for (const [, p] of this.pending) {
            if (p.host === hostname) {
                const existing = p.addresses ?? [];
                if (!existing.includes(addr)) {
                    p.addresses = [...existing, addr];
                }
                p.ttl = trackMinTtl(p.ttl, r.ttl);
                p.firstSeen = p.firstSeen || this.clock.now();
                p.lastSeen = this.clock.now();
            }
        }
    }

    // ── Private: coalescing ────────────────────────────────

    private getPending(key: string, srcAddress?: string): MutableService {
        let p = this.pending.get(key);
        if (!p) {
            p = {
                name: "",
                type: "",
                domain: "local",
                port: 0,
                priority: 0,
                weight: 0,
                ttl: 0,
                addresses: [],
                txt: {},
                subtypes: [],
                srcAddress,
                firstSeen: 0,
                lastSeen: 0,
            };
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
                const service = freeze(p);
                const nk = networkKey(service);
                const canonKey = this.byNetworkKey.get(nk);

                if (canonKey && canonKey !== key) {
                    // Same network endpoint already tracked under another
                    // instance name — merge into the canonical row instead of
                    // adding a duplicate. First-seen name stays canonical.
                    const existing = this.services.get(canonKey);
                    const merged = existing
                        ? mergeServices(existing, service)
                        : service;
                    this.services.set(canonKey, merged);
                    // Drop a stale standalone row under the alt name, if any.
                    this.services.delete(key);
                    this.emit({ type: "updated", service: merged });
                    continue;
                }

                // First sight of this endpoint, or the same name re-discovered.
                const wasNew = !this.services.has(key);
                const oldNk = this.canonKeyToNk.get(key);
                if (oldNk && oldNk !== nk) {
                    // This instance moved to a new network identity (e.g. port
                    // changed); release the old slot so a different service may
                    // claim it without being falsely merged into this one.
                    this.byNetworkKey.delete(oldNk);
                }
                this.services.set(key, service);
                this.byNetworkKey.set(nk, key);
                this.canonKeyToNk.set(key, nk);
                this.emit(
                    wasNew
                        ? { type: "added", service }
                        : { type: "updated", service }
                );
            }
            this.pending.clear();
        }, 250);
    }

    getDetailCached(
        svc: Pick<MdnsService, "name" | "type" | "host" | "port">
    ): { hit: boolean; detail: readonly MdnsDetailField[] } {
        const key = `${svc.name}|${svc.type}|${svc.host ?? ""}|${svc.port}`;
        const cached = this.detailCache.get(key);
        if (cached.hit && cached.value) {
            return { hit: true, detail: cached.value };
        }
        const full = this.getByKey(svc.name);
        const detail = full ? buildMdnsDetailFields(full) : [];
        this.detailCache.set(key, detail);
        return { hit: false, detail };
    }

    invalidateDetail(
        svc: Pick<MdnsService, "name" | "type" | "host" | "port">
    ): void {
        const key = `${svc.name}|${svc.type}|${svc.host ?? ""}|${svc.port}`;
        this.detailCache.invalidate(key);
    }

    /**
     * Remove services that have not been re-announced within their TTL grace
     * period (`ttl × TTL_GRACE_MULTIPLIER`, falling back to
     * `TTL_DEFAULT_SECONDS` when no TTL is known). Emits an `expired` event
     * per removed service so the panel can drop stale rows. A service that
     * keeps receiving packets has its `lastSeen` refreshed and never expires.
     */
    private expireStale(): void {
        const now = this.clock.now();
        const expired: MdnsService[] = [];
        for (const [key, svc] of this.services) {
            const ttl = svc.ttl || TTL_DEFAULT_SECONDS;
            const graceMs = ttl * 1000 * TTL_GRACE_MULTIPLIER;
            if (now - svc.lastSeen > graceMs) {
                expired.push(svc);
                this.services.delete(key);
                this.invalidateDetail(svc);
                // Keep the secondary dedup indexes in sync.
                const nk = this.canonKeyToNk.get(key);
                if (nk) {
                    this.byNetworkKey.delete(nk);
                    this.canonKeyToNk.delete(key);
                }
            }
        }
        for (const svc of expired) {
            this.emit({ type: "expired", service: svc });
        }
    }

    private emit(change: MdnsChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }
}