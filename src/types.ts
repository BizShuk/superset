import type * as vscode from "vscode";

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
    | { type: "expired"; service: MdnsService };

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

// ── Feature module types ─────────────────────────────

/**
 * Shared dependencies injected into every feature module by the
 * composition root (extension.ts). Each feature reads what it needs
 * and ignores the rest.
 */
export interface SharedDeps {
    readonly statusBar: vscode.StatusBarItem;
    readonly diag: vscode.OutputChannel;
    readonly log: (msg: string) => void;
}

export interface FeatureContext {
    readonly context: vscode.ExtensionContext;
    readonly subscriptions: vscode.Disposable[];
    readonly workspaceFolder: string;
    readonly shared: SharedDeps;
}

export interface FeatureHandle {
    dispose(): void;
}