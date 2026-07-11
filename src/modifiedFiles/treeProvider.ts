import * as vscode from "vscode";
import {
    type ModifiedFilesState,
    type ModifiedFilesStore,
} from "./modifiedFilesStore";
import * as treeSpec from "./treeSpec";
import type { TreeNode } from "./types";

const COLLAPSIBLE_MAP = {
    none: vscode.TreeItemCollapsibleState.None,
    collapsed: vscode.TreeItemCollapsibleState.Collapsed,
    expanded: vscode.TreeItemCollapsibleState.Expanded,
} as const;

/**
 * Sentinel element representing a status / error / empty message shown
 * inline in the tree. Distinct from `TreeNode` so the data layer can stay
 * focused on file/folder structure.
 */
export interface MessageElement {
    readonly kind: "__message";
    readonly text: string;
    readonly icon: string;
}

export type ProviderElement = TreeNode | MessageElement;

/**
 * Pure function: compute the root-level elements to display based on the
 * current store state. Extracted from `getChildren` so it can be unit-tested
 * without `vscode` mocks.
 *
 * Behaviour:
 * - error state  → single warning row showing the error message
 * - loading      → empty (no rows yet)
 * - ready + 0    → single check row showing "No modified files (scanning <repoRoot>)"
 * - ready + N    → the actual tree nodes
 */
export function computeRootChildren(
    state: ModifiedFilesState,
    repoRoot: string,
): ProviderElement[] {
    if (state.kind === "error") {
        return [{ kind: "__message", text: `⚠ ${state.message}`, icon: "warning" }];
    }
    if (state.kind !== "ready") return [];
    if (state.nodes.length === 0) {
        return [{
            kind: "__message",
            text: `No modified files (scanning ${repoRoot})`,
            icon: "check",
        }];
    }
    return [...state.nodes];
}

export class ModifiedFilesTreeProvider implements vscode.TreeDataProvider<ProviderElement> {
    private readonly emitter = new vscode.EventEmitter<ProviderElement | undefined>();
    readonly onDidChangeTreeData: vscode.Event<ProviderElement | undefined> = this.emitter.event;
    private storeListener: vscode.Disposable | undefined;

    constructor(
        private readonly store: ModifiedFilesStore,
        private readonly repoRoot: string,
    ) {
        this.storeListener = store.onDidChange(() => {
            // Re-render on every state transition (loading / ready / error),
            // not just `ready` — error & empty-state messages should appear too.
            this.emitter.fire(undefined);
        });
    }

    getTreeItem(element: ProviderElement): vscode.TreeItem {
        if (element.kind === "__message") {
            const item = new vscode.TreeItem(element.text);
            item.iconPath = new vscode.ThemeIcon(element.icon);
            item.collapsibleState = vscode.TreeItemCollapsibleState.None;
            item.contextValue = "modifiedMessage";
            return item;
        }
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

    getChildren(element?: ProviderElement): vscode.ProviderResult<ProviderElement[]> {
        if (element && element.kind === "__message") return [];
        const state = this.store.getState();
        if (!element) return computeRootChildren(state, this.repoRoot);
        // element is a TreeNode here (folder or file)
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