import type { TopologyChange, TopologyListener, TopologyNode } from "./types";
import type { ScannerTransport } from "./topologyScanner";
import { transformScan } from "./transformer";

/**
 * Maximum time a single `scan()` call may take before we abandon the
 * result and reset state. Defends against hung `traceroute` invocations
 * leaving the store permanently `scanning = true`. Pre-refactor this
 * timeout was missing — see `plans/architecture-topology.md` §6 stage 3.
 */
export const SCAN_TIMEOUT_MS = 10_000;

/**
 * Pure data layer for network topology.
 * No `vscode` imports — the scanner is injected. Tree assembly is
 * delegated to `transformScan()` in `./transformer`.
 */
export class TopologyStore {
    private nodes: TopologyNode[] = [];
    private listeners = new Set<TopologyListener>();
    private scanning = false;
    private activeScanPromise: Promise<void> | null = null;

    constructor(private readonly scanner: ScannerTransport) {}

    start(): void {
        // No-op: scan is triggered on-demand by the user.
    }

    stop(): void {
        this.nodes = [];
        this.listeners.clear();
        this.scanning = false;
        this.activeScanPromise = null;
    }

    reset(): void {
        this.nodes = [];
        this.scanning = false;
        this.activeScanPromise = null;
        this.emit({ type: "scanned", nodes: [] });
    }

    getRoots(): TopologyNode[] {
        return this.nodes;
    }

    scan(): Promise<void> {
        if (this.activeScanPromise) {
            return this.activeScanPromise;
        }

        this.activeScanPromise = this.runScan();
        return this.activeScanPromise;
    }

    private async runScan(): Promise<void> {
        this.scanning = true;
        try {
            const fanout = Promise.all([
                this.scanner.listInterfaces(),
                this.scanner.getDefaultGateway(),
                this.scanner.traceroute("8.8.8.8"),
                this.scanner.resolveDnsServers(),
                this.scanner.listArpTable(),
            ]);
            // Hard cap so a hung `traceroute` cannot leave the store
            // permanently `scanning = true`. Race is intentionally
            // *not* awaited: the timeout branch wins and the original
            // fanout is allowed to settle in the background (its
            // resolved values are dropped here, which is harmless
            // because the next scan() call will re-issue everything).
            const winner = await Promise.race([
                fanout,
                new Promise<"timeout">((resolve) =>
                    setTimeout(() => resolve("timeout"), SCAN_TIMEOUT_MS)
                ),
            ]);
            if (winner === "timeout") {
                // Reset state but do not emit — the previous nodes
                // remain on screen so the user keeps context. Active
                // listeners get nothing so the tree doesn't flicker.
                return;
            }
            const [interfaces, gateway, hops, dnsServers, arp] = winner;

            const nodes = transformScan({
                interfaces,
                gateway,
                hops,
                dnsServers,
                arp,
            });
            this.nodes = nodes;
            this.emit({ type: "scanned", nodes: this.nodes });
        } finally {
            this.scanning = false;
            this.activeScanPromise = null;
        }
    }

    onDidChange(listener: TopologyListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(change: TopologyChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }
}
