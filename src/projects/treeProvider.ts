import * as vscode from "vscode";
import type { ProjectNode, ProjectsListener } from "./types";
import type { ProjectStore } from "./projectStore";

/**
 * vscode-bound TreeDataProvider for the projects list.
 * Groups projects by layer and provides commands to open folder.
 */
export class ProjectsTreeProvider implements vscode.TreeDataProvider<ProjectNode> {
    private readonly emitter = new vscode.EventEmitter<ProjectNode | ProjectNode[] | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;

    private unsubscribeStore?: () => void;

    constructor(private readonly store: ProjectStore) {}

    start(): void {
        if (this.unsubscribeStore) return;
        const handler: ProjectsListener = () => {
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

    getTreeItem(element: ProjectNode): vscode.TreeItem {
        if (element.type === "subgroup") {
            const item = new vscode.TreeItem(element.label);
            item.collapsibleState = element.children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed;
            item.contextValue = "subgroup";
            item.iconPath = new vscode.ThemeIcon("folder");
            return item;
        } else {
            const item = new vscode.TreeItem(element.name);
            item.collapsibleState = vscode.TreeItemCollapsibleState.None;
            item.contextValue = "project";
            
            // Format path description (replace /Users/<username> with ~)
            const displayPath = element.path.replace(/^\/Users\/[^/]+/, "~");
            item.description = displayPath;
            item.tooltip = element.path;
            item.iconPath = new vscode.ThemeIcon("repo");
            
            item.command = {
                command: "superset.openProject",
                title: "Open Project",
                arguments: [element.path]
            };
            return item;
        }
    }

    getChildren(element?: ProjectNode): vscode.ProviderResult<ProjectNode[]> {
        if (!element) {
            return this.store.getRoots();
        }
        if (element.type === "subgroup") {
            return element.children;
        }
        return [];
    }
}
