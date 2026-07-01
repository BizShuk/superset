import * as vscode from "vscode";
import type { TopologyListener, TopologyNode } from "./types";
import type { TopologyStore } from "./topologyStore";
import { buildTopologySpec } from "./treeSpec";

/**
 * vscode-bound TreeDataProvider for network topology.
 * Shows group nodes (expandable) and leaf nodes (non-expandable).
 */
export class TopologyTreeProvider
    implements vscode.TreeDataProvider<TopologyNode>
{
    private readonly emitter = new vscode.EventEmitter<
        TopologyNode | TopologyNode[] | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;

    private unsubscribeStore?: () => void;

    constructor(private readonly store: TopologyStore) {}

    start(): void {
        if (this.unsubscribeStore) return;
        const handler: TopologyListener = () => {
            this.emitter.fire(undefined);
        };
        this.unsubscribeStore = this.store.onDidChange(handler);
    }

    stop(): void {
        this.unsubscribeStore?.();
        this.unsubscribeStore = undefined;
    }

    refresh(): void {
        this.emitter.fire(undefined);
    }

    getTreeItem(element: TopologyNode): vscode.TreeItem {
        const spec = buildTopologySpec(element);
        const item = new vscode.TreeItem(spec.label);
        item.description = spec.description;
        // No icon — clean look
        item.contextValue = spec.contextValue;
        const hasChildren =
            element.children && element.children.length > 0;
        item.collapsibleState = hasChildren
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;
        return item;
    }

    getChildren(
        element?: TopologyNode
    ): vscode.ProviderResult<TopologyNode[]> {
        if (!element) {
            return this.store.getRoots();
        }
        return element.children ?? [];
    }
}
