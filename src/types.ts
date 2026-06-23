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
    readonly name: string;
    readonly type: string; // e.g. "_http._tcp"
    readonly domain: string; // "local"
    readonly port: number;
    readonly host?: string;
    readonly addresses: readonly string[];
    readonly txt: Readonly<Record<string, string>>;
    readonly firstSeen: number;
    readonly lastSeen: number;
}

export type MdnsChange =
    | { type: "added"; service: MdnsService }
    | { type: "removed"; service: MdnsService }
    | { type: "updated"; service: MdnsService };

export type MdnsListener = (change: MdnsChange) => void;