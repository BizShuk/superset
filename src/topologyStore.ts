import type { TopologyChange, TopologyListener, TopologyNode } from "./types";

export interface TopologyScanner {
    scan(): Promise<TopologyNode[]>;
}

/**
 * Pure data layer for network topology.
 * No `vscode` imports — the scanner is injected.
 */
export class TopologyStore {
    private nodes: TopologyNode[] = [];
    private listeners = new Set<TopologyListener>();
    private scanning = false;

    constructor(private readonly scanner: TopologyScanner) {}

    start(): void {
        // No-op: scan is triggered on-demand by the user.
    }

    stop(): void {
        this.nodes = [];
        this.listeners.clear();
        this.scanning = false;
    }

    getRoots(): TopologyNode[] {
        return this.nodes;
    }

    async scan(): Promise<void> {
        if (this.scanning) return;
        this.scanning = true;
        try {
            this.nodes = await this.scanner.scan();
            this.emit({ type: "scanned", nodes: this.nodes });
        } finally {
            this.scanning = false;
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