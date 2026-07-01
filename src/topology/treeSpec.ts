import type { TopologyNode } from "./types";

export interface TopologyTreeItemSpec {
    label: string;
    description?: string;
    iconKind: "group" | "leaf";
    contextValue: "topologyGroup" | "topologyLeaf";
}

export function buildTopologySpec(node: TopologyNode): TopologyTreeItemSpec {
    if (node.children && node.children.length > 0) {
        return {
            label: node.label,
            description: node.description,
            iconKind: "group",
            contextValue: "topologyGroup",
        };
    }
    return {
        label: node.label,
        description: node.description,
        iconKind: "leaf",
        contextValue: "topologyLeaf",
    };
}
