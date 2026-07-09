// TreeViewRegistry — runtime registry for every `vscode.TreeView` the
// extension owns. Panels (terminals / mdns / topology / todo /
// projectsTodo / future settings) register their view via
// `ctx.registerTreeView(viewId, treeView, treeDataProvider)` and the
// `superset.revealInTree` command can then walk any panel's tree to
// locate and focus a specific item by predicate.
//
// Pure infrastructure: no `vscode` business logic, no panel-specific
// types — all data flows through the standard `TreeDataProvider<T>`
// contract. Walking is bounded by `MAX_WALK_DEPTH` and
// `WALK_TIMEOUT_MS` so a pathological tree can't hang the call.

import type * as vscode from "vscode";

/** Hard cap on recursive `getChildren` depth. The deepest tree
 *  in the codebase (terminals) is ~3 levels deep; 5 leaves headroom
 *  for future panels without risking an infinite loop on a buggy
 *  provider. */
const MAX_WALK_DEPTH = 5;

/** Wall-clock cap on a single reveal attempt. A panel whose
 *  `getChildren` is slow won't block the caller indefinitely; the
 *  walker gives up and reports `false`. */
const WALK_TIMEOUT_MS = 3_000;

export interface TreeViewEntry<T = unknown> {
    treeView: vscode.TreeView<T>;
    treeDataProvider: vscode.TreeDataProvider<T>;
}

export class TreeViewRegistry {
    private readonly entries = new Map<string, TreeViewEntry<unknown>>();

    /**
     * Register a `viewId → { treeView, treeDataProvider }` mapping.
     * If the same `viewId` is registered twice the second wins and
     * a warning is logged (this signals a plugin activation bug —
     * we don't silently overwrite the first registration).
     */
    register(
        viewId: string,
        treeView: vscode.TreeView<unknown>,
        treeDataProvider: vscode.TreeDataProvider<unknown>,
        log: (msg: string) => void
    ): vscode.Disposable {
        if (this.entries.has(viewId)) {
            log(
                `TreeViewRegistry: re-registering ${viewId} (this is usually a bug)`
            );
        }
        this.entries.set(viewId, { treeView, treeDataProvider });
        return {
            dispose: () => {
                if (this.entries.get(viewId)?.treeView === treeView) {
                    this.entries.delete(viewId);
                }
            },
        };
    }

    /**
     * Look up the entry for `viewId`. Returns `undefined` if the
     * panel hasn't registered yet (e.g. user invokes before
     * activation completes).
     */
    get<T = unknown>(viewId: string): TreeViewEntry<T> | undefined {
        return this.entries.get(viewId) as TreeViewEntry<T> | undefined;
    }

    /**
     * Walk the tree of `viewId`, return the first item matching
     * `predicate`. The walk is bounded by `MAX_WALK_DEPTH` and
     * `WALK_TIMEOUT_MS`. Returns `undefined` on no-match, timeout,
     * or missing viewId.
     *
     * The walk uses an explicit queue (BFS) so deeply-nested
     * trees are also bounded — DFS recursion would risk stack
     * overflow on misbehaving providers.
     */
    async find<T = unknown>(
        viewId: string,
        predicate: (item: T) => boolean
    ): Promise<T | undefined> {
        const entry = this.entries.get(viewId);
        if (!entry) return undefined;
        const deadline = Date.now() + WALK_TIMEOUT_MS;
        const root = await entry.treeDataProvider.getChildren(
            undefined as unknown as T
        );
        if (!root) return undefined;
        const queue: Array<{ node: T; depth: number }> = root.map(
            (n) => ({ node: n as T, depth: 1 })
        );
        const seen = new WeakSet<object>();
        while (queue.length > 0) {
            if (Date.now() > deadline) return undefined;
            const { node, depth } = queue.shift()!;
            if (!node || typeof node !== "object") continue;
            if (seen.has(node as object)) continue;
            seen.add(node as object);
            if (predicate(node)) return node;
            if (depth >= MAX_WALK_DEPTH) continue;
            const children = await entry.treeDataProvider.getChildren(
                node as T
            );
            if (children) {
                for (const c of children) {
                    queue.push({ node: c as T, depth: depth + 1 });
                }
            }
        }
        return undefined;
    }

    /**
     * Find + focus + select an item by predicate. Steps:
     *  1. Look up the view; if missing, log + return `false`.
     *  2. Focus the view container so the panel becomes visible.
     *  3. Focus the inner view so it has keyboard focus.
     *  4. Walk to find the matching item; if none, return `false`.
     *  5. Call `treeView.reveal(item, { select: true, focus: true })`.
     *
     * Returns `true` on success, `false` on any failure (predicate
     * unmatched, view not registered, walk timeout, etc.). The
     * caller can use this for retry / fallback.
     */
    async reveal(
        viewId: string,
        predicate: (item: unknown) => boolean,
        log: (msg: string) => void
    ): Promise<boolean> {
        const entry = this.entries.get(viewId);
        if (!entry) {
            log(
                `TreeViewRegistry.reveal: no entry for viewId=${viewId}`
            );
            return false;
        }
        // Best-effort focus the parent container + the inner view.
        // The view container id is the viewId's prefix (`superset.`
        // → `superset` and `superset-overall`). Both focus calls
        // are wrapped in try/catch because the view might not be
        // visible in the current layout.
        try {
            const containerId = viewId.startsWith("superset.")
                ? viewId.split(".")[0] === "superset"
                    ? "superset"
                    : "superset-overall"
                : "superset";
            await import("vscode").then((vs) =>
                vs.commands.executeCommand(
                    `workbench.view.extension.${containerId}`
                )
            );
        } catch {
            // View container might not exist; ignore.
        }
        try {
            await import("vscode").then((vs) =>
                vs.commands.executeCommand(`${viewId}.focus`)
            );
        } catch {
            // View not yet visible; ignore — reveal() will still try.
        }
        const item = await this.find(viewId, predicate);
        if (!item) {
            log(
                `TreeViewRegistry.reveal: no match in ${viewId} for predicate`
            );
            return false;
        }
        try {
            await entry.treeView.reveal(item, {
                select: true,
                focus: true,
            });
            return true;
        } catch (err) {
            log(
                `TreeViewRegistry.reveal: treeView.reveal failed: ${String(
                    err
                )}`
            );
            return false;
        }
    }

    /** Snapshot of registered viewIds — useful for diagnostics. */
    listViewIds(): string[] {
        return [...this.entries.keys()];
    }
}

/** Singleton, owned by the composition root. Set via
 *  `setTreeViewRegistry(registry)` in `extension.ts` after
 *  construction. */
let registryRef: TreeViewRegistry | undefined;
export function setTreeViewRegistry(registry: TreeViewRegistry): void {
    registryRef = registry;
}
export function getTreeViewRegistry(): TreeViewRegistry | undefined {
    return registryRef;
}