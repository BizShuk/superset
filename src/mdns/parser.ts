// MdnsParser — pure DNS-SD record → MutableService transforms. No
// state, no timers, no VSCode dependency. The registry hands parser
// functions a record + a MutableService, and the parser mutates the
// service in place. This is the *extract* of the handlePtr/handleSrv/
// handleTxt/handleAddress methods that used to live inside
// `MdnsRegistry`; behaviour is identical so the existing 23-case
// test suite passes without modification.

import type { MdnsService } from "./types";

/** Mutable in-progress service record. Owned by the registry's
 *  `pending` map; never escapes the parser. */
export interface MutableService {
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

/** Initialise an empty `MutableService`. `firstSeen`/`lastSeen` stay
 *  at 0 so the caller can detect "not yet stamped" and apply `now()`
 *  once on first sight. */
export function createMutableService(): MutableService {
    return {
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
        firstSeen: 0,
        lastSeen: 0,
    };
}

/** Track the minimum TTL across all records for a service. */
export function trackMinTtl(current: number, incoming: number): number {
    if (current === 0) return incoming;
    return Math.min(current, incoming);
}

/**
 * Extract the subtype from a PTR name like "_printer._sub._http._tcp".
 * Returns the subtype string (e.g. "_printer") or undefined.
 */
export function extractSubtype(typeName: string): string | undefined {
    const parts = typeName.split(".");
    const subIdx = parts.indexOf("_sub");
    if (subIdx <= 0) return undefined;
    const subtype = parts[subIdx - 1];
    return subtype?.startsWith("_") ? subtype : undefined;
}

/**
 * Strip the subtype segment from a type name.
 * "_printer._sub._http._tcp" → "_http._tcp"
 */
export function stripSubtype(typeName: string): string {
    const parts = typeName.split(".");
    const subIdx = parts.indexOf("_sub");
    if (subIdx <= 0) return typeName;
    return parts.slice(subIdx + 1).join(".");
}

/**
 * Convert a `MutableService` to its immutable `MdnsService` snapshot.
 * Arrays and records are deep-copied so consumers can't mutate the
 * store's internal state.
 */
export function freezeMutable(s: MutableService): MdnsService {
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

// ── Record handlers ────────────────────────────────────────

/** A loose shape for a DNS-SD record as it arrives in a packet. */
export interface RawRecord {
    name: string;
    type: string;
    ttl: number;
    data: unknown;
}

/** Handle a PTR record. */
export function applyPtr(
    r: RawRecord,
    pending: MutableService,
    now: number
): void {
    const data = r.data as string;
    if (typeof data !== "string") return;

    if (data === r.name) return; // skip self-referential

    if (!pending.name) {
        pending.name = data;
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
    pending.firstSeen = pending.firstSeen || now;
    pending.lastSeen = now;
}

/** Handle an SRV record. */
export function applySrv(
    r: RawRecord,
    pending: MutableService,
    now: number
): void {
    const data = r.data as {
        port?: number;
        target?: string;
        priority?: number;
        weight?: number;
    };
    if (!data || typeof data.port !== "number") return;

    pending.port = data.port;
    pending.priority = data.priority ?? 0;
    pending.weight = data.weight ?? 0;
    if (data.target) {
        pending.host = data.target.replace(/\.$/i, "");
    }
    pending.ttl = trackMinTtl(pending.ttl, r.ttl);
    pending.firstSeen = pending.firstSeen || now;
    pending.lastSeen = now;
}

/** Handle a TXT record. Supports both `Record<string,string>` and
 *  the length-prefixed binary format used by some implementations. */
export function applyTxt(
    r: RawRecord,
    pending: MutableService,
    now: number
): void {
    const data = r.data as Record<string, string> | Buffer | undefined;
    if (!data) return;

    let txt: Record<string, string> = {};
    if (Buffer.isBuffer(data)) {
        let off = 0;
        while (off < data.length) {
            const len = data[off];
            if (len === 0) break;
            const str = data
                .slice(off + 1, off + 1 + len)
                .toString("utf-8");
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
    pending.firstSeen = pending.firstSeen || now;
    pending.lastSeen = now;
}

/** Handle an A/AAAA record. Updates the hostname's own address list
 *  AND any service whose `host` matches this hostname. */
export function applyAddress(
    r: RawRecord,
    pendingMap: Map<string, MutableService>,
    now: number
): void {
    const data = r.data as string;
    if (typeof data !== "string") return;

    const addr = data;
    const hostname = r.name.replace(/\.$/i, "");

    const self = pendingMap.get(hostname);
    if (self) {
        const existing = self.addresses ?? [];
        if (!existing.includes(addr)) {
            self.addresses = [...existing, addr];
        }
        self.ttl = trackMinTtl(self.ttl, r.ttl);
        self.firstSeen = self.firstSeen || now;
        self.lastSeen = now;
    }

    for (const [, p] of pendingMap) {
        if (p.host === hostname) {
            const existing = p.addresses ?? [];
            if (!existing.includes(addr)) {
                p.addresses = [...existing, addr];
            }
            p.ttl = trackMinTtl(p.ttl, r.ttl);
            p.firstSeen = p.firstSeen || now;
            p.lastSeen = now;
        }
    }
}
