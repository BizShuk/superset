// mDNS-feature domain types.

export interface MdnsService {
    /** Instance name, e.g. "MyPrinter._http._tcp.local" */
    readonly name: string;
    /** Service type, e.g. "_http._tcp" */
    readonly type: string;
    /** DNS domain, almost always "local" for mDNS */
    readonly domain: string;
    /** TCP/UDP port from SRV record */
    readonly port: number;
    /** SRV priority — lower = higher priority. Client should try lower first. */
    readonly priority: number;
    /** SRV weight — relative weight for same-priority hosts (0 = default). */
    readonly weight: number;
    /** Minimum TTL across all records that compose this service (seconds). */
    readonly ttl: number;
    /** Hostname from SRV target, e.g. "myserver.local" */
    readonly host?: string;
    /** IPv4/IPv6 addresses from A/AAAA records */
    readonly addresses: readonly string[];
    /** TXT key-value pairs, e.g. { path: "/api", version: "1.0" } */
    readonly txt: Readonly<Record<string, string>>;
    /** Subtypes extracted from PTR records, e.g. ["_printer"] */
    readonly subtypes: readonly string[];
    /**
     * Other mDNS instance names that resolved to the same network endpoint
     * (host|port|type) and were merged into this canonical row.
     * First-seen name is the canonical `name`; the rest land here.
     */
    readonly aliases?: readonly string[];
    /** Source IP of the multicast packet (network interface identifier) */
    readonly srcAddress?: string;
    /** Timestamp of first discovery (ms epoch) */
    readonly firstSeen: number;
    /** Timestamp of last re-discovery (ms epoch) */
    readonly lastSeen: number;
}

export type MdnsChange =
    | { type: "added"; service: MdnsService }
    | { type: "removed"; service: MdnsService }
    | { type: "updated"; service: MdnsService }
    | { type: "expired"; service: MdnsService }
    | { type: "reset" };

export type MdnsListener = (change: MdnsChange) => void;
