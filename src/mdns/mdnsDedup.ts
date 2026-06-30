import type { MdnsService } from "./types";

/** Inputs needed to compute a service's network identity. */
export type NetworkKeyInput = Pick<MdnsService, "host" | "port" | "type"> & {
    addresses?: readonly string[];
};

/**
 * Build the secondary dedup key `host|port|type` for a service.
 * Falls back to the first address when no hostname is known, so the same
 * physical host (reachable by IP) still collapses across NICs / IPv4+IPv6.
 *
 * Two services that share this key are the same network endpoint and should
 * be merged into a single row regardless of their mDNS instance names.
 */
export function networkKey(s: NetworkKeyInput): string {
    const id = s.host ?? s.addresses?.[0] ?? "";
    return `${id}|${s.port}|${s.type}`;
}

/**
 * Merge service `b` into canonical service `a` (first-seen name wins).
 *
 * - `name`: kept from `a` (canonical); `b.name` + prior aliases → `aliases`.
 * - `addresses` / `subtypes`: unioned, deduped, order-preserved.
 * - `ttl`: minimum (matches the registry's trackMinTtl semantics).
 * - `txt`: `b` overrides `a` per-key (latest wins).
 * - `firstSeen`: earliest; `lastSeen`: most recent — so a freshly re-seen
 *   alias does not leave a stale `lastSeen` that the expiry scanner would
 *   trip over.
 */
export function mergeServices(a: MdnsService, b: MdnsService): MdnsService {
    const aliases = Array.from(
        new Set([...(a.aliases ?? []), a.name, b.name])
    ).filter((n) => n !== a.name);

    const addresses = Array.from(
        new Set([...(a.addresses ?? []), ...(b.addresses ?? [])])
    );

    const subtypes = Array.from(
        new Set([...(a.subtypes ?? []), ...(b.subtypes ?? [])])
    );

    const ttl =
        a.ttl === 0 ? b.ttl : b.ttl === 0 ? a.ttl : Math.min(a.ttl, b.ttl);

    return {
        ...b,
        name: a.name,
        aliases,
        addresses,
        subtypes,
        txt: { ...(a.txt ?? {}), ...(b.txt ?? {}) },
        ttl,
        firstSeen: Math.min(a.firstSeen ?? 0, b.firstSeen ?? 0),
        lastSeen: Math.max(a.lastSeen ?? 0, b.lastSeen ?? 0),
    };
}
