import * as vscode from "vscode";
import type { ExplorerListener, ExplorerNode } from "./types";
import type { ExplorerStore } from "./explorerStore";
import { buildExplorerTreeItemSpec } from "./explorerTreeSpec";

/**
 * vscode-bound TreeDataProvider for the workspace file explorer.
 * Lazy-enumerates children via `ExplorerStore.getChildren()`.
 */
export class ExplorerTreeProvider
    implements vscode.TreeDataProvider<ExplorerNode>
{
    private readonly emitter = new vscode.EventEmitter<
        ExplorerNode | ExplorerNode[] | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;

    private unsubscribeStore?: () => void;

    constructor(private readonly store: ExplorerStore) {}

    start(): void {
        if (this.unsubscribeStore) return;
        const handler: ExplorerListener = (change) => {
            switch (change.type) {
                case "rootChanged":
                    this.emitter.fire(undefined);
                    break;
                case "nodeChanged":
                case "nodeRemoved":
                    this.emitter.fire(undefined);
                    break;
            }
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

    getTreeItem(element: ExplorerNode): vscode.TreeItem {
        const spec = buildExplorerTreeItemSpec(element);
        const item = new vscode.TreeItem(spec.label);
        item.iconPath = new vscode.ThemeIcon(
            spec.iconKind === "folder" ? "folder" : "file"
        );
        item.description = spec.description;
        item.contextValue = spec.contextValue;
        item.collapsibleState = element.isDirectory
            ? element.children === undefined
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;
        if (spec.command) {
            item.command = {
                command: spec.command.command,
                title: spec.command.title,
                arguments: spec.command.arguments,
            };
        }
        return item;
    }

    getChildren(element?: ExplorerNode): vscode.ProviderResult<ExplorerNode[]> {
        if (!element) {
            return this.store.getRoots();
        }
        if (!element.isDirectory) {
            return [];
        }
        return this.store.getChildren(element.uri);
    }

    getParent(element: ExplorerNode): vscode.ProviderResult<ExplorerNode> {
        return this.store.getParent(element.uri);
    }
}