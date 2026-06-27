// Topology-feature domain types.

export interface TopologyNode {
    readonly label: string;
    readonly description?: string;
    readonly children?: TopologyNode[];
}

export type TopologyChange = { type: "scanned"; nodes: TopologyNode[] };
export type TopologyListener = (change: TopologyChange) => void;
