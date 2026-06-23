import * as vscode from "vscode";
import type { TodoChange, TodoItem } from "./types";
import type { TodoStore } from "./todoStore";

/**
 * vscode-bound TreeDataProvider for the TODO list.
 * Reads from a TodoStore (which reads from README.todo).
 * Clicking a todo item toggles its checkbox.
 */
export class TodoTreeProvider
    implements vscode.TreeDataProvider<TodoItem>
{
    private readonly emitter = new vscode.EventEmitter<
        TodoItem | TodoItem[] | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;

    private unsubscribeStore?: () => void;

    constructor(private readonly store: TodoStore) {}

    start(): void {
        if (this.unsubscribeStore) return;
        const handler: (change: TodoChange) => void = (change) => {
            if (change.type === "loaded") {
                this.emitter.fire(undefined);
            } else if (change.type === "toggled") {
                this.emitter.fire(change.item);
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

    getTreeItem(element: TodoItem): vscode.TreeItem {
        const item = new vscode.TreeItem(element.text);
        item.iconPath = new vscode.ThemeIcon(
            element.checked ? "pass" : "circle-large-outline",
            element.checked
                ? new vscode.ThemeColor("charts.green")
                : new vscode.ThemeColor("charts.yellow")
        );
        item.description = element.checked ? "✓" : undefined;
        item.tooltip = element.checked
            ? `${element.text} (completed)`
            : `${element.text} (pending)`;
        item.collapsibleState =
            element.children && element.children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None;
        item.command = {
            command: "superset.todoToggle",
            title: "Toggle Todo",
            arguments: [element],
        };
        item.contextValue = element.checked ? "todoDone" : "todoPending";
        return item;
    }

    getChildren(element?: TodoItem): vscode.ProviderResult<TodoItem[]> {
        const items = element ? (element.children || []) : this.store.getItems();
        // Pending first, completed last
        return [
            ...items.filter((t) => !t.checked),
            ...items.filter((t) => t.checked),
        ];
    }
}