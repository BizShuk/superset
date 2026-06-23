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

    constructor(private readonly scanner: TopologyScanner) {}

    getRoots(): TopologyNode[] {
        return this.nodes;
    }

    async scan(): Promise<void> {
        this.nodes = await this.scanner.scan();
        this.emit({ type: "scanned", nodes: this.nodes });
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