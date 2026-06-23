import type { ExplorerNode } from "./types";

export type ExplorerIconKind = "folder" | "file";

export interface ExplorerTreeItemSpec {
    label: string;
    iconKind: ExplorerIconKind;
    description?: string;
    command?: { command: string; title: string; arguments: unknown[] };
    contextValue: "explorerDir" | "explorerFile";
}

export function buildExplorerTreeItemSpec(
    node: ExplorerNode
): ExplorerTreeItemSpec {
    if (node.isDirectory) {
        const childCount =
            node.children !== undefined ? `(${node.children.length})` : "";
        return {
            label: node.name,
            iconKind: "folder",
            description: childCount || undefined,
            contextValue: "explorerDir",
        };
    }
    return {
        label: node.name,
        iconKind: "file",
        command: {
            command: "superset.exploreOpen",
            title: "Open File",
            arguments: [node],
        },
        contextValue: "explorerFile",
    };
}