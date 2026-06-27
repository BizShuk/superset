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
    /**
     * Active priority filter. When empty (the default), every priority is
     * shown. When non-empty, only items whose [Px] tag is in the set are
     * shown; items without a priority prefix are hidden while a filter
     * is active (filtering for "P0+P1" implies "show only those").
     */
    private enabledPriorities = new Set<"P0" | "P1" | "P2">();

    constructor(
        private readonly store: TodoStore,
        private readonly extensionUri?: vscode.Uri
    ) {}

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

    /**
     * Toggle a priority in the active filter. When the set is empty after
     * the toggle, no priority filter is applied (all priorities shown).
     */
    togglePriorityFilter(p: "P0" | "P1" | "P2"): boolean {
        if (this.enabledPriorities.has(p)) {
            this.enabledPriorities.delete(p);
        } else {
            this.enabledPriorities.add(p);
        }
        this.refresh();
        return this.enabledPriorities.has(p);
    }

    isPriorityEnabled(p: "P0" | "P1" | "P2"): boolean {
        return this.enabledPriorities.has(p);
    }

    getTreeItem(element: TodoItem): vscode.TreeItem {
        if (element.kind === "list") {
            return this.buildListItem(element);
        }

        const priorityMatch = element.text.match(/^(\[|\()?(P[0-2])(\]|\))?[\s-:]*/i);
        // Strip the [P0]/[P1]/[P2] prefix from the label — the priority
        // is conveyed by the SVG icon, so the label just shows the task name.
        const labelText = priorityMatch
            ? element.text.substring(priorityMatch[0].length).trim()
            : element.text;

        const item = new vscode.TreeItem(labelText);

        if (priorityMatch && !element.checked && this.extensionUri) {
            const p = priorityMatch[2].toUpperCase();
            // VSCode loads SVG files referenced via Uri directly — no need
            // to read the file content and wrap as data URI.
            item.iconPath = vscode.Uri.joinPath(this.extensionUri, "resources", `${p.toLowerCase()}.svg`);
        } else {
            item.iconPath = new vscode.ThemeIcon(
                element.checked ? "pass" : "circle-large-outline",
                element.checked
                    ? new vscode.ThemeColor("charts.green")
                    : new vscode.ThemeColor("charts.yellow")
            );
        }

        item.description = element.checked ? "✓" : undefined;
        item.tooltip = element.checked
            ? `${element.text} (completed)`
            : `${element.text} (pending)`;
        item.collapsibleState =
            element.children && element.children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None;
        // No item.command — toggle is driven by the native checkboxState
        // (only checkbox icon click triggers it; clicking the row text does
        // nothing). The framework fires onDidChangeCheckboxState which the
        // feature module wires to superset.todoToggle.
        item.checkboxState = element.checked
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked;
        item.contextValue = "todoCheckbox";
        return item;
    }

    /**
     * Render a `- foo` / `* bar` / `+ baz` line that has no checkbox
     * marker. The node is structurally a list item (so it can nest
     * children) but is not actionable: no toggle command, a muted
     * dash icon, and a `todoList` contextValue so menu `when` clauses
     * can target it if needed in the future.
     */
    private buildListItem(element: TodoItem): vscode.TreeItem {
        const priorityMatch = element.text.match(/^(\[|\()?(P[0-2])(\]|\))?[\s-:]*/i);
        const labelText = priorityMatch
            ? element.text.substring(priorityMatch[0].length).trim()
            : element.text;

        const item = new vscode.TreeItem(labelText);

        if (priorityMatch && this.extensionUri) {
            const p = priorityMatch[2].toUpperCase();
            item.iconPath = vscode.Uri.joinPath(this.extensionUri, "resources", `${p.toLowerCase()}.svg`);
        } else {
            item.iconPath = new vscode.ThemeIcon(
                "dash",
                new vscode.ThemeColor("descriptionForeground")
            );
        }

        item.tooltip = element.text;
        item.collapsibleState =
            element.children && element.children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None;
        // No command → click does nothing for list items.
        item.contextValue = "todoList";
        return item;
    }

    getChildren(element?: TodoItem): vscode.ProviderResult<TodoItem[]> {
        const raw = element ? element.children || [] : this.store.getItems();
        const completedFiltered = this.showCompleted ? raw : filterCompleted(raw);
        const filtered = applyPriorityFilter(completedFiltered, this.enabledPriorities);
        return sortSiblings(filtered);
    }
}

/**
 * Sort siblings for display. The "pending first, completed last"
 * heuristic only makes sense when every sibling is a checkbox; once
 * a `list` node is mixed in (a free-form note interleaved with
 * tasks) we preserve the original document order — list items have
 * no completion status so the sort has no meaning for them.
 */
function sortSiblings(items: TodoItem[]): TodoItem[] {
    if (items.length === 0) return items;
    const allCheckboxes = items.every((t) => t.kind === "checkbox");
    if (!allCheckboxes) return items;
    return [
        ...items.filter((t) => !t.checked),
        ...items.filter((t) => t.checked),
    ];
}

/**
 * Filter items by active priority set. When `enabledPriorities` is empty,
 * returns items unchanged. Otherwise keeps only items whose leading
 * `[Px]`/`(Px)` tag is in the set. Items without a priority prefix are
 * hidden while any priority filter is active — "show P0+P1" means "show
 * only P0 and P1", not "show P0+P1 plus un-prioritised items".
 *
 * Recurses into children so a filtered parent keeps only matching kids.
 *
 * Exported for unit testing.
 */
export function applyPriorityFilter(
    items: TodoItem[],
    enabledPriorities: Set<"P0" | "P1" | "P2">
): TodoItem[] {
    if (enabledPriorities.size === 0) return items;
    return items
        .map((item) => {
            const filteredChildren = item.children
                ? applyPriorityFilter(item.children, enabledPriorities)
                : undefined;
            const m = item.text.match(/^(\[|\()?(P[0-2])(\]|\))?/i);
            const tag = m?.[2]?.toUpperCase();
            const matches =
                tag !== undefined &&
                (tag === "P0" || tag === "P1" || tag === "P2") &&
                enabledPriorities.has(tag);
            if (matches) {
                return filteredChildren
                    ? { ...item, children: filteredChildren }
                    : item;
            }
            return null;
        })
        .filter((t): t is TodoItem => t !== null);
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
    // List-only nodes have no `checked` state, so the rule is N/A
    // for them: they always survive (the user wrote them intentionally).
    if (item.kind === "checkbox" && item.checked && !hasSurvivingChild) {
        return null;
    }
    return {
        ...item,
        children: filteredChildren,
    };
}
