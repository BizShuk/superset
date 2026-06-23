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
    /**
     * When false, items that are "fully completed" (self checked AND
     * every descendant checked) are hidden. A parent that is checked
     * but has unchecked descendants is NOT considered fully done and
     * stays visible — its pending children would be unreachable
     * otherwise.
     *
     * Default true to preserve the previous behavior (no filter).
     */
    private showCompleted = true;

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

    /**
     * Flip the "show completed" flag and re-fire the change event so
     * the tree re-renders. Returns the new value so callers (e.g. the
     * filter command) can update UI affordances like button icons.
     */
    toggleShowCompleted(): boolean {
        this.showCompleted = !this.showCompleted;
        this.refresh();
        return this.showCompleted;
    }

    isShowingCompleted(): boolean {
        return this.showCompleted;
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
        const raw = element ? element.children || [] : this.store.getItems();
        const filtered = this.showCompleted
            ? raw
            : filterCompleted(raw);
        // Pending first, completed last
        return [
            ...filtered.filter((t) => !t.checked),
            ...filtered.filter((t) => t.checked),
        ];
    }
}

/**
 * Return a new list with "fully completed" items removed when the
 * filter is active. A node is "fully completed" iff itself is checked
 * AND every descendant is checked. An item that survives keeps its
 * filtered children so the tree stays consistent (no orphan sub-tasks
 * popping up under a still-visible parent).
 *
 * Exported for unit testing without needing the vscode-bound provider.
 */
export function filterCompleted(items: TodoItem[]): TodoItem[] {
    return items
        .map((item) => filterItem(item))
        .filter((t): t is TodoItem => t !== null);
}

function filterItem(item: TodoItem): TodoItem | null {
    const filteredChildren = item.children
        ? filterCompleted(item.children)
        : undefined;
    const hasSurvivingChild =
        filteredChildren !== undefined && filteredChildren.length > 0;
    // "Fully completed" = self checked AND no surviving child to act on.
    // We treat "no children at all" the same as "children all filtered
    // out" — both mean there is nothing left to do under this node.
    if (item.checked && !hasSurvivingChild) {
        return null;
    }
    return {
        ...item,
        children: filteredChildren,
    };
}