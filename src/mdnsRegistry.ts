import type { MdnsChange, MdnsListener, MdnsService } from "./types";
import type { MdnsPacket, MdnsTransport } from "./mdnsTransport";

/** Mutable internal representation for coalescing DNS records. */
interface MutableService {
    name: string;
    type: string;
    domain: string;
    port: number;
    host?: string;
    addresses: string[];
    txt: Record<string, string>;
    firstSeen: number;
    lastSeen: number;
}

function freeze(s: MutableService): MdnsService {
    return {
        name: s.name,
        type: s.type,
        domain: s.domain,
        port: s.port,
        host: s.host,
        addresses: s.addresses.slice(),
        txt: { ...s.txt },
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

    constructor(private readonly transport: MdnsTransport) {}

    // ── Lifecycle ──────────────────────────────────────────

    start(): void {
        if (this.unsubscribeTransport) return;
        this.unsubscribeTransport = this.transport.onPacket((pkt) =>
            this.handlePacket(pkt)
        );
        this.transport.start();
        this.transport.browse();
    }

    stop(): void {
        this.unsubscribeTransport?.();
        this.unsubscribeTransport = undefined;
        if (this.coalesceTimer) {
            clearTimeout(this.coalesceTimer);
            this.coalesceTimer = undefined;
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
                this.handlePtr(r);
            } else if (r.type === "SRV") {
                this.handleSrv(r);
            } else if (r.type === "TXT") {
                this.handleTxt(r);
            } else if (r.type === "A" || r.type === "AAAA") {
                this.handleAddress(r);
            }
        }

        this.flushPending();
    }

    private handlePtr(r: {
        name: string;
        type: string;
        ttl: number;
        data: unknown;
    }): void {
        const data = r.data as string;
        if (typeof data !== "string") return;

        // r.name is the service type (e.g. "_http._tcp.local")
        // data is the instance name (e.g. "MyPrinter._http._tcp.local")
        if (data === r.name) return; // skip self-referential

        const key = data; // instance name is the key
        const pending = this.getPending(key);
        if (!pending.name) {
            pending.name = data;
            pending.type = r.name.replace(/\.local\.?$/i, "");
            pending.domain = "local";
        }
        pending.firstSeen = pending.firstSeen ?? Date.now();
        pending.lastSeen = Date.now();
    }

    private handleSrv(r: {
        name: string;
        type: string;
        ttl: number;
        data: unknown;
    }): void {
        const data = r.data as {
            port?: number;
            target?: string;
        };
        if (!data || typeof data.port !== "number") return;

        const key = r.name;
        const pending = this.getPending(key);
        pending.port = data.port;
        if (data.target) {
            pending.host = data.target.replace(/\.$/i, "");
        }
        pending.firstSeen = pending.firstSeen ?? Date.now();
        pending.lastSeen = Date.now();
    }

    private handleTxt(r: {
        name: string;
        type: string;
        ttl: number;
        data: unknown;
    }): void {
        const data = r.data as Record<string, string> | Buffer | undefined;
        if (!data) return;

        const key = r.name;
        const pending = this.getPending(key);

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
        pending.firstSeen = pending.firstSeen ?? Date.now();
        pending.lastSeen = Date.now();
    }

    private handleAddress(r: {
        name: string;
        type: string;
        ttl: number;
        data: unknown;
    }): void {
        const data = r.data as string;
        if (typeof data !== "string") return;

        const addr = data;
        const hostname = r.name.replace(/\.$/i, "");

        // Add address to the hostname entry itself
        const self = this.getPending(hostname);
        const selfAddrs = self.addresses ?? [];
        if (!selfAddrs.includes(addr)) {
            self.addresses = [...selfAddrs, addr];
        }
        self.firstSeen = self.firstSeen ?? Date.now();
        self.lastSeen = Date.now();

        // Also add to any service whose host matches this hostname
        for (const [, p] of this.pending) {
            if (p.host === hostname) {
                const existing = p.addresses ?? [];
                if (!existing.includes(addr)) {
                    p.addresses = [...existing, addr];
                }
                p.firstSeen = p.firstSeen ?? Date.now();
                p.lastSeen = Date.now();
            }
        }
    }

    // ── Private: coalescing ────────────────────────────────

    private getPending(key: string): MutableService {
        let p = this.pending.get(key);
        if (!p) {
            p = {
                name: "",
                type: "",
                domain: "local",
                port: 0,
                addresses: [],
                txt: {},
                firstSeen: 0,
                lastSeen: 0,
            };
            this.pending.set(key, p);
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
                const existing = this.services.get(key);
                if (existing) {
                    this.services.set(key, service);
                    this.emit({ type: "updated", service });
                } else {
                    this.services.set(key, service);
                    this.emit({ type: "added", service });
                }
            }
            this.pending.clear();
        }, 250);
    }

    private emit(change: MdnsChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }
}