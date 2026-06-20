import * as vscode from "vscode";
import type { TerminalHandle } from "./types";
import type { TerminalRegistry } from "./terminalRegistry";
import { buildTreeItemSpec } from "./treeSpec";

export { UNSEEN_PREFIX, stripUnseenPrefix } from "./treeSpec";

const DEFAULT_REFRESH_INTERVAL_MS = 3000;

/**
 * vscode-bound TreeDataProvider. Reads the registry and constructs
 * actual vscode.TreeItem instances. Not unit-tested directly (vscode
 * runtime required); relies on buildTreeItemSpec for visual logic.
 *
 * A periodic `onDidChangeTreeData` tick is required because VSCode
 * does not expose `onDidChangeTerminalName`; without it, user-initiated
 * renames (e.g., via the "Rename Terminal" command) leave the panel
 * showing the stale name. The tick is short enough to feel responsive
 * and long enough to avoid UI thrash.
 */
export class TerminalTreeProvider implements vscode.TreeDataProvider<TerminalHandle> {
    private readonly emitter = new vscode.EventEmitter<
        TerminalHandle | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;

    private unsubscribe?: () => void;
    private refreshTimer?: ReturnType<typeof setInterval>;
    private unseen = new Set<TerminalHandle>();

    constructor(
        private readonly registry: TerminalRegistry,
        private readonly refreshIntervalMs: number = DEFAULT_REFRESH_INTERVAL_MS
    ) {}

    start(): void {
        if (this.unsubscribe) {
            return;
        }
        this.refreshUnseenSet();
        this.unsubscribe = this.registry.onDidChange((change) => {
            if (change.type === "unseenChanged") {
                if (change.hasUnseenOutput) {
                    this.unseen.add(change.terminal);
                } else {
                    this.unseen.delete(change.terminal);
                }
                this.emitter.fire(change.terminal);
            } else if (change.type === "removed") {
                this.unseen.delete(change.terminal);
                this.emitter.fire(change.terminal);
            } else {
                this.emitter.fire(undefined);
            }
        });
        if (this.refreshIntervalMs > 0) {
            this.refreshTimer = setInterval(() => {
                this.emitter.fire(undefined);
            }, this.refreshIntervalMs);
        }
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        if (this.refreshTimer !== undefined) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    getTreeItem(element: TerminalHandle): vscode.TreeItem {
        const spec = buildTreeItemSpec(element, {
            isUnseen: this.unseen.has(element),
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
        // contextValue is the discriminator for `menus.view.item.context`
        // (the inline [X] close button). Keep aligned with package.json.
        item.contextValue = spec.contextValue;
        return item;
    }

    getChildren(): TerminalHandle[] {
        return this.registry.getAll();
    }

    private refreshUnseenSet(): void {
        this.unseen = new Set(this.registry.getUnseen());
    }
}
