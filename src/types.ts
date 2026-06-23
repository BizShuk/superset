export interface TerminalHandle {
    readonly name: string;
    show(): void;
    /** Kill the terminal process and remove it from the dashboard. */
    dispose(): void;
}

export type TerminalId = string;

export interface TerminalEntry {
    readonly id: TerminalId;
    readonly terminal: TerminalHandle;
    readonly hasUnseenOutput: boolean;
}

export type RegistryChange =
    | { type: "added"; terminal: TerminalHandle }
    | { type: "removed"; terminal: TerminalHandle }
    | {
          type: "unseenChanged";
          terminal: TerminalHandle;
          hasUnseenOutput: boolean;
      };

export type RegistryListener = (change: RegistryChange) => void;

// ── Explorer types ──────────────────────────────────

export interface ExplorerNode {
    /** Absolute file path. */
    readonly uri: string;
    readonly name: string;
    readonly isDirectory: boolean;
    /** undefined = not yet enumerated (lazy). */
    children?: ExplorerNode[];
}

export type ExplorerChange =
    | { type: "rootChanged" }
    | { type: "nodeChanged"; uri: string }
    | { type: "nodeRemoved"; uri: string };

export type ExplorerListener = (change: ExplorerChange) => void;

// ── mDNS types ──────────────────────────────────────

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
    | { type: "updated"; service: MdnsService };

export type MdnsListener = (change: MdnsChange) => void;

// ── Topology types ──────────────────────────────────

export interface TopologyNode {
    readonly label: string;
    readonly description?: string;
    readonly children?: TopologyNode[];
}

export type TopologyChange = { type: "scanned"; nodes: TopologyNode[] };
export type TopologyListener = (change: TopologyChange) => void;

// ── Todo types ─────────────────────────────────────

export interface TodoItem {
    readonly line: number;
    readonly text: string;
    /**
     * "checkbox" = `- [ ]` / `- [x]` line; can be toggled.
     * "list"     = `- foo` / `* bar` / `+ baz` line **without** the
     *              `[ ]` checkbox marker. Rendered as a non-togglable
     *              tree node so the panel mirrors the file's list
     *              structure for free-form notes interleaved with
     *              actionable items. `checked` is always `false` for
     *              list items.
     */
    readonly kind: "checkbox" | "list";
    checked: boolean;
    children?: TodoItem[];
}

export type TodoChange =
    | { type: "loaded"; items: TodoItem[] }
    | { type: "toggled"; item: TodoItem };

export type TodoListener = (change: TodoChange) => void;