import * as vscode from "vscode";
import * as treeSpec from "./treeSpec";
import type { ModifiedFilesStore } from "./modifiedFilesStore";
import type { TreeNode } from "./types";

const COLLAPSIBLE_MAP = {
    none: vscode.TreeItemCollapsibleState.None,
    collapsed: vscode.TreeItemCollapsibleState.Collapsed,
    expanded: vscode.TreeItemCollapsibleState.Expanded,
} as const;

export class ModifiedFilesTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined> = this.emitter.event;
    private storeListener: vscode.Disposable | undefined;

    constructor(
        private readonly store: ModifiedFilesStore,
        private readonly repoRoot: string,
    ) {
        this.storeListener = store.onDidChange(state => {
            if (state.kind === "ready") this.emitter.fire(undefined);
        });
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        const spec = treeSpec.buildTreeItem(element);
        const item = new vscode.TreeItem(spec.label);
        item.iconPath = new vscode.ThemeIcon(spec.iconId);
        if (spec.description) item.description = spec.description;
        item.tooltip = spec.tooltip;
        item.collapsibleState = COLLAPSIBLE_MAP[spec.collapsibleState];
        item.contextValue = spec.contextValue;
        if (spec.command) {
            // spec.command.args carries repo-relative path as string.
            // Resolve to absolute URI and wrap in vscode.open's expected shape.
            const relPath = spec.command.args[0] as string;
            item.command = {
                command: "vscode.open",
                title: "Open Modified File",
                arguments: [vscode.Uri.file(this.absPath(relPath))],
            };
        }
        return item;
    }

    getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
        const state = this.store.getState();
        if (state.kind !== "ready") return [];
        if (!element) return [...state.nodes];
        if (element.kind === "folder") return [...element.children];
        return [];
    }

    dispose(): void {
        this.storeListener?.dispose();
        this.storeListener = undefined;
        this.emitter.dispose();
    }

    private absPath(repoRel: string): string {
        // Lazy require to keep this file from adding a top-level Node import.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require("path") as typeof import("path");
        return path.isAbsolute(repoRel) ? repoRel : path.join(this.repoRoot, repoRel);
    }
}