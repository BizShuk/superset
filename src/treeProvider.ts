import * as vscode from "vscode";
import type { TerminalHandle } from "./types";
import type { TerminalRegistry } from "./terminalRegistry";
import { GroupStore, type Group } from "./groupStore";
import { buildTreeItemSpec, buildGroupSpec } from "./treeSpec";

export { UNSEEN_PREFIX, stripUnseenPrefix } from "./treeSpec";

type TreeElement = Group | TerminalHandle;

const DEFAULT_REFRESH_INTERVAL_MS = 3000;

/**
 * vscode-bound TreeDataProvider. Reads the registry AND the group store
 * to produce a two-level tree: groups at the root, terminals inside each
 * group. Implements `getParent` so VSCode can `reveal()` elements and
 * traverse the tree during drag-and-drop.
 *
 * A periodic `onDidChangeTreeData` tick is still required because VSCode
 * does not expose `onDidChangeTerminalName`; without it, user-initiated
 * renames leave the panel showing the stale name.
 */
export class TerminalTreeProvider implements vscode.TreeDataProvider<TreeElement> {
    private readonly emitter = new vscode.EventEmitter<
        TreeElement | TreeElement[] | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;

    private unsubscribeRegistry?: () => void;
    private unsubscribeGroupStore?: () => void;
    private refreshTimer?: ReturnType<typeof setInterval>;
    private unseen = new Set<TerminalHandle>();

    constructor(
        private readonly registry: TerminalRegistry,
        private readonly groupStore: GroupStore,
        private readonly refreshIntervalMs: number = DEFAULT_REFRESH_INTERVAL_MS
    ) {}

    start(): void {
        if (this.unsubscribeRegistry) {
            return;
        }
        this.refreshUnseenSet();

        this.unsubscribeRegistry = this.registry.onDidChange((change) => {
            if (change.type === "unseenChanged") {
                if (change.hasUnseenOutput) {
                    this.unseen.add(change.terminal);
                } else {
                    this.unseen.delete(change.terminal);
                }
                // Fire both the terminal and its parent group so the
                // aggregate unseen count updates on the group row.
                const group = this.groupStore.getGroupOf(change.terminal);
                this.emitter.fire([change.terminal, group]);
            } else if (change.type === "removed") {
                this.unseen.delete(change.terminal);
                this.groupStore.removeTerminal(change.terminal);
                this.emitter.fire(undefined);
            } else if (change.type === "added") {
                this.groupStore.assignDefaultGroup(change.terminal);
                this.emitter.fire(undefined);
            }
        });

        this.unsubscribeGroupStore = this.groupStore.onDidChange((change) => {
            switch (change.type) {
                case "groupAdded":
                case "groupRemoved":
                case "groupOrderChanged":
                case "terminalAssigned":
                case "terminalUnassigned":
                    this.emitter.fire(undefined);
                    break;
                case "groupChanged":
                    this.emitter.fire(
                        this.groupStore.getGroup(change.groupId)
                    );
                    break;
            }
        });

        if (this.refreshIntervalMs > 0) {
            this.refreshTimer = setInterval(() => {
                this.emitter.fire(undefined);
            }, this.refreshIntervalMs);
        }
    }

    stop(): void {
        this.unsubscribeRegistry?.();
        this.unsubscribeRegistry = undefined;
        this.unsubscribeGroupStore?.();
        this.unsubscribeGroupStore = undefined;
        if (this.refreshTimer !== undefined) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    /**
     * Force a full tree refresh. Used after side-channel mutations
     * (e.g., rename, drag-and-drop) that don't go through the registry.
     */
    refresh(): void {
        this.emitter.fire(undefined);
    }

    getTreeItem(element: TreeElement): vscode.TreeItem {
        if (isGroup(element)) {
            return this.buildGroupTreeItem(element);
        }
        return this.buildTerminalTreeItem(element);
    }

    getChildren(element?: TreeElement): TreeElement[] {
        if (!element) {
            return this.groupStore.getGroups();
        }
        if (isGroup(element)) {
            return element.terminals;
        }
        return [];
    }

    getParent(element: TreeElement): TreeElement | undefined {
        if (isGroup(element)) {
            return undefined;
        }
        return this.groupStore.getGroupOf(element);
    }

    // ── Private builders ───────────────────────────────────

    private buildGroupTreeItem(group: Group): vscode.TreeItem {
        const unseenCount = this.groupStore.aggregateUnseen(
            group.terminals,
            (t) => this.unseen.has(t)
        );
        const spec = buildGroupSpec(group, { unseenCount });
        const item = new vscode.TreeItem(spec.label);
        item.id = spec.id;
        item.description = spec.description;
        item.iconPath = new vscode.ThemeIcon(
            spec.iconKind === "groupHighlighted" ? "folder-active" : "folder",
            new vscode.ThemeColor(
                `charts.${spec.color === "magenta" ? "purple" : spec.color}`
            )
        );
        item.collapsibleState =
            spec.collapsibleState === "expanded"
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed;
        item.contextValue = spec.contextValue;
        return item;
    }

    private buildTerminalTreeItem(terminal: TerminalHandle): vscode.TreeItem {
        const spec = buildTreeItemSpec(terminal, {
            isUnseen: this.unseen.has(terminal),
        });
        const item = new vscode.TreeItem(spec.label);
        item.description = spec.description;
        item.iconPath = new vscode.ThemeIcon(
            spec.iconKind === "highlighted" ? "circle-filled" : "terminal",
            spec.iconKind === "highlighted"
                ? new vscode.ThemeColor("charts.yellow")
                : undefined
        );
        item.command = {
            command: spec.command.command,
            title: "Focus Terminal",
            arguments: spec.command.arguments,
        };
        item.contextValue = spec.contextValue;
        return item;
    }

    private refreshUnseenSet(): void {
        this.unseen = new Set(
            this.registry.getUnseen().map((e) => e.terminal)
        );
    }
}

/** Type guard shared between the provider and the drag-and-drop layer. */
export function isGroup(e: unknown): e is Group {
    return (
        typeof (e as Group)?.id === "string" &&
        Array.isArray((e as Group)?.terminals)
    );
}