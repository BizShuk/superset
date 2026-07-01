import * as vscode from "vscode";
import * as path from "path";
import type { TodoChange, TodoItem, TodoViewType } from "./types";
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
    private showCompleted = false;
    /**
     * Active priority filter. When empty (the default), every priority is
     * shown. When non-empty, only items whose [Px] tag is in the set are
     * shown; items without a priority prefix are hidden while a filter
     * is active (filtering for "P0+P1" implies "show only those").
     */
    private enabledPriorities = new Set<"P0" | "P1" | "P2">();
    private viewType: TodoViewType = "section";

    constructor(
        private readonly store: TodoStore,
        private readonly extensionUri?: vscode.Uri
    ) {}

    start(): void {
        void vscode.commands.executeCommand("setContext", "superset.todo.viewType", this.viewType);
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

    setViewType(type: TodoViewType): void {
        this.viewType = type;
        void vscode.commands.executeCommand("setContext", "superset.todo.viewType", type);
        this.refresh();
    }

    getViewType(): TodoViewType {
        return this.viewType;
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
        if (element.kind === "section") {
            return this.buildSectionItem(element);
        }
        if (element.kind === "list") {
            return this.buildListItem(element);
        }

        const priorityMatch = element.text.match(/^(\[|\()?(P[0-2])(\]|\))?[\s-:]*/i);
        // Strip the [P0]/[P1]/[P2] prefix from the label — the priority
        // is conveyed by the SVG icon, so the label just shows the task name.
        let labelText = priorityMatch
            ? element.text.substring(priorityMatch[0].length).trim()
            : element.text;

        const hasLink = extractLink(labelText) !== null;
        if (hasLink) {
            labelText = cleanLabelText(labelText);
        }

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
        item.contextValue = hasLink ? "todoCheckboxWithLink" : "todoCheckbox";
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
        let labelText = priorityMatch
            ? element.text.substring(priorityMatch[0].length).trim()
            : element.text;

        const hasLink = extractLink(labelText) !== null;
        if (hasLink) {
            labelText = cleanLabelText(labelText);
        }

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
        item.contextValue = hasLink ? "todoListWithLink" : "todoList";
        return item;
    }

    private buildSectionItem(element: TodoItem): vscode.TreeItem {
        const item = new vscode.TreeItem(element.text);
        item.iconPath = new vscode.ThemeIcon("tag");
        if (element.text === "README.todo") {
            item.iconPath = new vscode.ThemeIcon("file-text");
        } else if (element.text.includes(".")) {
            item.iconPath = new vscode.ThemeIcon("file");
        } else if (element.text === "P0" || element.text === "P1" || element.text === "P2") {
            if (this.extensionUri) {
                item.iconPath = vscode.Uri.joinPath(this.extensionUri, "resources", `${element.text.toLowerCase()}.svg`);
            }
        }
        item.description = element.description;
        item.tooltip = element.description ? `${element.description}/${element.text}` : element.text;
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        item.contextValue = "todoSection";
        return item;
    }

    private collectAllItems(items: TodoItem[]): TodoItem[] {
        const result: TodoItem[] = [];
        const traverse = (list: TodoItem[]) => {
            for (const item of list) {
                if (item.kind !== "section") {
                    result.push(item);
                }
                if (item.children) {
                    traverse(item.children);
                }
            }
        };
        traverse(items);
        return result;
    }

    private buildPriorityGroups(items: TodoItem[]): TodoItem[] {
        const flatItems = this.collectAllItems(items);
        const p0: TodoItem[] = [];
        const p1: TodoItem[] = [];
        const p2: TodoItem[] = [];
        const none: TodoItem[] = [];

        for (const item of flatItems) {
            const m = item.text.match(/^(\[|\()?(P[0-2])(\]|\))?/i);
            const tag = m?.[2]?.toUpperCase();
            const copy = { ...item, children: undefined };
            if (tag === "P0") {
                p0.push(copy);
            } else if (tag === "P1") {
                p1.push(copy);
            } else if (tag === "P2") {
                p2.push(copy);
            } else {
                none.push(copy);
            }
        }

        const groups: TodoItem[] = [];
        if (p0.length > 0) {
            groups.push({ line: -100, text: "P0", kind: "section", checked: false, children: p0 });
        }
        if (p1.length > 0) {
            groups.push({ line: -101, text: "P1", kind: "section", checked: false, children: p1 });
        }
        if (p2.length > 0) {
            groups.push({ line: -102, text: "P2", kind: "section", checked: false, children: p2 });
        }
        if (none.length > 0) {
            groups.push({ line: -103, text: "None", kind: "section", checked: false, children: none });
        }
        return groups;
    }

    private buildFileGroups(items: TodoItem[]): TodoItem[] {
        const flatItems = this.collectAllItems(items);
        const groupsMap = new Map<string, { label: string; description?: string; children: TodoItem[] }>();

        for (const item of flatItems) {
            const grp = this.getFileGroup(item.text);
            const key = grp.label;
            const copy = { ...item, children: undefined };

            const existing = groupsMap.get(key) ?? { label: grp.label, description: grp.description, children: [] };
            existing.children.push(copy);
            groupsMap.set(key, existing);
        }

        const groups: TodoItem[] = [];
        let index = 0;
        for (const val of groupsMap.values()) {
            groups.push({
                line: -200 - index,
                text: val.label,
                description: val.description,
                kind: "section",
                checked: false,
                children: val.children,
            });
            index++;
        }

        groups.sort((a, b) => {
            if (a.text === "README.todo") return -1;
            if (b.text === "README.todo") return 1;
            return a.text.localeCompare(b.text);
        });
        return groups;
    }

    private getFileGroup(text: string): { label: string; description?: string } {
        const link = extractLink(text);
        if (!link) {
            return { label: "README.todo" };
        }
        let cleanLink = link.split("#")[0];
        if (!cleanLink.toLowerCase().endsWith(".todo")) {
            return { label: "README.todo" };
        }
        if (cleanLink.startsWith("file:///")) {
            const p = cleanLink.substring(8);
            return this.getFileLabelAndDesc(p);
        }
        return this.getFileLabelAndDesc(cleanLink);
    }

    private getFileLabelAndDesc(filePath: string): { label: string; description?: string } {
        if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
            try {
                const url = new URL(filePath);
                return { label: url.hostname, description: url.pathname };
            } catch {
                return { label: filePath };
            }
        }
        const normalized = filePath.replace(/\\/g, "/");
        const parts = normalized.split("/");
        const label = parts[parts.length - 1] || filePath;
        const description = parts.length > 1 ? parts.slice(0, -1).join("/") : undefined;
        return { label, description };
    }

    getChildren(element?: TodoItem): vscode.ProviderResult<TodoItem[]> {
        if (element) {
            return sortSiblings(element.children || []);
        }

        const raw = this.store.getItems();
        const completedFiltered = this.showCompleted ? raw : filterCompleted(raw);
        const filtered = applyPriorityFilter(completedFiltered, this.enabledPriorities);

        if (this.viewType === "priority") {
            return this.buildPriorityGroups(filtered);
        }
        if (this.viewType === "file") {
            return this.buildFileGroups(filtered);
        }

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
            if (item.kind === "section") {
                const filteredChildren = item.children
                    ? applyPriorityFilter(item.children, enabledPriorities)
                    : undefined;
                if (filteredChildren && filteredChildren.length > 0) {
                    return { ...item, children: filteredChildren };
                }
                return null;
            }
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
    if (item.kind === "section" && item.text.toLowerCase() === "archive") {
        return null;
    }
    const filteredChildren = item.children
        ? filterCompleted(item.children)
        : undefined;
    // "Fully completed" = self checked AND no *actionable* descendant left.
    // Actionable = an unchecked checkbox somewhere in the subtree. Plain
    // `list` notes always survive filtering, but they carry no work, so
    // they must NOT keep a completed parent visible — otherwise a checked
    // task whose only children are free-form notes lingers in the panel.
    // A checked parent with an unchecked checkbox child stays (there is
    // still something to do); one whose children are checkbox-free is hidden.
    const hasActionableChild =
        filteredChildren !== undefined &&
        filteredChildren.some(hasPendingCheckbox);
    if (item.kind === "checkbox" && item.checked && !hasActionableChild) {
        return null;
    }
    return {
        ...item,
        children: filteredChildren,
    };
}

/**
 * True iff `item`'s subtree contains at least one unchecked checkbox —
 * i.e. there is still actionable work under it. `list` and `section`
 * nodes have no checkbox state of their own, so they only count via
 * their descendants. Used to decide whether a completed parent should
 * remain visible.
 */
function hasPendingCheckbox(item: TodoItem): boolean {
    if (item.kind === "checkbox" && !item.checked) {
        return true;
    }
    return (item.children ?? []).some(hasPendingCheckbox);
}

/**
 * Extract the first hyperlink (Markdown link target or raw HTTP/HTTPS URL) from text.
 * Exported for testing.
 */
export function extractLink(text: string): string | null {
    // 1. Check for markdown link: [text](target)
    const markdownMatch = text.match(/\[[^\]]*\]\(([^)]+)\)/);
    if (markdownMatch) {
        return markdownMatch[1].trim();
    }
    // 2. Check for HTTP/HTTPS URL
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
        return urlMatch[0].trim();
    }
    return null;
}

/**
 * Replace markdown links [text](target) with just the link text.
 * Exported for testing.
 */
export function cleanLabelText(text: string): string {
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

export interface ResolvedLink {
    readonly type: "url" | "file";
    readonly uriOrPath: string;
}

/**
 * Resolves a todo link target to a full path or URL, taking into account workspace relative paths and file:// protocols.
 * Exported for testing.
 */
export function resolveTodoLink(target: string, workspaceFolder: string): ResolvedLink {
    if (
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("file:///")
    ) {
        return { type: "url", uriOrPath: target };
    }

    let cleanPath = target;
    if (target.startsWith("file://")) {
        cleanPath = target.substring(7);
    }

    const resolvedPath = path.isAbsolute(cleanPath)
        ? cleanPath
        : path.join(workspaceFolder, cleanPath);

    return { type: "file", uriOrPath: resolvedPath };
}

