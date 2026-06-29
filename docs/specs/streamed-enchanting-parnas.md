# Plan: Terminal Groups with Drag-and-Drop

## Context

The Superset dashboard panel currently renders all live terminals as a flat list. There is no way to organize terminals by purpose (e.g. "Frontend", "Backend", "TUI scratch"), no way to hide an entire cluster of work, and no way to reorder items by hand. The existing `WindowGroupNode` type in `src/types.ts` declares a `kind: "window"` parent node, but the current `TerminalTreeProvider` never renders it — `getChildren()` returns `registry.getAll()` directly, producing a single flat level.

This plan introduces **named, colored, collapsible groups** with first-class drag-and-drop:

- A built-in **未分組** (Ungrouped) group is created at extension start; every newly-opened terminal auto-joins it.
- Users create new groups via a new `+` toolbar button next to the existing **New Terminal** button.
- Groups have a user-editable name, a color tag from a fixed palette, and per-group collapse state.
- **Both** terminals and groups are draggable. Terminals move within or across groups; groups reorder among themselves.
- Each group shows the aggregate `unseen` count of its members.
- The HighlightPresenter status bar continues to reflect a global count, but the per-group aggregation is computed in the new GroupStore.

The work is structured around a new **GroupStore** that holds group membership, group ordering, group names/colors, and per-group collapse state. The existing `TerminalRegistry` stays untouched as the single source of truth for terminal presence + unseen flags; the GroupStore merely maps `TerminalHandle -> GroupId` and exposes a sorted, ordered projection used by the tree.

## Architecture Decisions

### 1. Where does group state live? — A separate `GroupStore`

Group membership is not a property of the terminal itself; it is a UI concern. Putting it in `TerminalRegistry` would couple "terminal is open" semantics to "where it is shown in the tree", and would force every registry listener to reason about groups.

Instead, add a new `src/groupStore.ts` (sibling to `terminalRegistry.ts`) that:

- Owns a `Map<GroupId, Group>` where `Group = { id, name, color, collapsed, terminals: TerminalHandle[] (ordered) }`
- Owns a `Map<TerminalHandle, GroupId>` reverse map (terminals not in the map are in **未分組**)
- Exposes `getGroups(): Group[]` returning groups in display order with terminals in their stored order
- Exposes a `moveTerminalToGroup(terminal, targetGroupId, position?)` API used by drag-and-drop
- Exposes `moveGroup(groupId, position)` for group reordering
- Exposes `createGroup(name)`, `renameGroup(id, name)`, `setGroupColor(id, color)`, `toggleGroupCollapsed(id)`, `deleteGroup(id)`
- Emits its own `onDidChange` event so the tree can refresh when only group metadata changes (rename, color, collapse). When a terminal is added/removed/moved between groups, the tree re-renders affected elements.

The reverse map is also written on terminal *open* / *close*: the extension wires `registry.onDidChange(added/removed)` to `groupStore.assignDefaultGroup(terminal)` / `groupStore.removeTerminal(terminal)`. The default group is the one with `id === "ungrouped"`; we never let the user delete the default.

### 2. TreeDataProvider element type

Today: `TreeDataProvider<TerminalHandle>` with `getChildren(): TerminalHandle[]`.

After: the element type becomes a union `Group | TerminalHandle`. The provider implements:

- `getChildren(element?)`:
  - `undefined` → returns all groups in display order.
  - `Group` → returns that group's terminals in stored order (or `[]` if collapsed — but VSCode handles collapse via `collapsibleState`, so we always return the children; the tree view hides them when collapsed).
- `getTreeItem(element)`:
  - If `element` is a `Group` → build a `TreeItem` with collapsible state, color swatch description, aggregate unseen count, and `contextValue: "group"`.
  - If `element` is a `TerminalHandle` → same `buildTreeItemSpec` path as today.
- `getParent(element)`:
  - Terminal → the group it belongs to.
  - Group → `undefined` (root).
  - Required for `reveal()` and for drag-and-drop tree traversal.

We keep the existing `buildTreeItemSpec(terminal, opts)` unchanged; we add a new pure `buildGroupSpec(group, opts)` next to it. The `vscode`-bound `TerminalTreeProvider.getTreeItem` branches on the element type and converts the spec into a `vscode.TreeItem`.

### 3. Drag-and-drop mapping

A new `TreeDragAndDropController<TreeElement>` is attached to the existing `treeView`. We use a single custom mime type `"application/vnd.code.tree.superset.terminals/dnd"` (the auto-added tree mime is fine, but we add a custom one so we can carry structured payloads as JSON if we ever need cross-extension drops; for now same-tree drops use the in-memory `DataTransferItem.value` round-trip, which is the cheapest path).

- `handleDrag(source, dataTransfer, token)`:
  - For each dragged terminal, store the `TerminalHandle` in a custom mime slot (preserved across same-extension-host drops).
  - For each dragged group, store a small `{ kind: "group", id: GroupId }` object.
  - VSCode already adds the tree's own mime type with the same elements, but we add a stable, versioned mime for clarity.

- `handleDrop(target, dataTransfer, token)`:
  - Determine the target bucket from `target`:
    - `target === undefined` → root (groups at top level only)
    - `target` is a `Group` → that group (terminals dropped onto a group header join the group; groups dropped onto another group are reordered)
    - `target` is a `TerminalHandle` → drop *above/below/on* that terminal. The exact slot is inferred from the position reported via the `DataTransfer` metadata: VSCode exposes `dataTransfer.items` and we read the visual position via a small convention. Since stable API does not expose the cursor Y, we use this rule: when the user drops on a terminal leaf, the dragged element goes **after** that terminal in the same group; if the dragged element is a group, groups always go to the end of the root list (terminals cannot drop on another group's body in stable API without a position).
  - The handler dispatches to `groupStore.moveTerminalToGroup(...)` or `groupStore.moveGroup(...)`.
  - After mutation, fire `onDidChangeTreeData(undefined)` to refresh the affected subtrees.

A simpler alternative is to use **only** the auto-added tree mime type and read items back via `dataTransfer.get(...)`. We adopt this: the `value` field of `DataTransferItem` is the original element reference, so we don't need to JSON-encode anything for same-tree drops. The custom mime slot is added only as a defensive fallback. The code uses whichever the dataTransfer actually contains.

### 4. The `WindowGroupNode` type

The existing `WindowGroupNode` in `types.ts` is a vestigial type with no live usage. We **remove** it. The new `Group` type (defined in `groupStore.ts`) replaces it functionally and is the actual element type used by the tree. The `TreeElement` union is **dropped** entirely; the new tree provider is generic over `Group | TerminalHandle` and uses structural types.

`buildWindowGroupSpec` in `treeSpec.ts` is removed. The function was unused and we now have a real `buildGroupSpec` to do the same job with real data.

### 5. Backwards compatibility

- The `TerminalRegistry` is untouched. All 14 `terminalRegistry.test.ts` cases continue to pass.
- The `HighlightPresenter` is untouched. All 10 `highlightPresenter.test.ts` cases continue to pass.
- `buildTreeItemSpec` is unchanged. All 5 `treeProvider.test.ts` cases continue to pass.
- New `groupStore.test.ts` and `groupTree.test.ts` (if extracted) cover the new code.

## File-by-File Implementation

### 1. `src/types.ts` — clean up unused types

Remove `WindowGroupNode` and the `TreeElement` union. The two live types stay as-is:

```ts
export interface TerminalHandle {
    readonly name: string;
    show(): void;
    dispose(): void;
}

export type RegistryChange =
    | { type: "added"; terminal: TerminalHandle }
    | { type: "removed"; terminal: TerminalHandle }
    | { type: "unseenChanged"; terminal: TerminalHandle; hasUnseenOutput: boolean };

export type RegistryListener = (change: RegistryChange) => void;
```

### 2. `src/groupStore.ts` (new)

Pure data layer. No `vscode` imports. Designed to be unit-testable with the same `fakeTerminal` style used elsewhere.

```ts
import type { TerminalHandle } from "./types";

export const UNGROUPED_ID = "ungrouped" as const;
export type GroupId = string; // opaque, but UNGROUPED_ID is reserved

export type GroupColor =
    | "red" | "orange" | "yellow" | "green"
    | "blue" | "purple" | "magenta" | "gray";

export interface Group {
    readonly id: GroupId;
    name: string;
    color: GroupColor;
    collapsed: boolean;
    /** Ordered list of terminals that belong to this group. */
    terminals: TerminalHandle[];
}

export type GroupStoreChange =
    | { type: "groupAdded"; group: Group }
    | { type: "groupRemoved"; groupId: GroupId }
    | { type: "groupChanged"; groupId: GroupId }   // rename / color / collapse
    | { type: "groupOrderChanged" }
    | { type: "terminalAssigned"; terminal: TerminalHandle; groupId: GroupId }
    | { type: "terminalUnassigned"; terminal: TerminalHandle };

export type GroupStoreListener = (change: GroupStoreChange) => void;

export class GroupStore {
    private groups = new Map<GroupId, Group>();          // insertion order = display order
    private terminalToGroup = new Map<TerminalHandle, GroupId>();
    private listeners = new Set<GroupStoreListener>();

    constructor() {
        // Built-in default group: cannot be deleted or renamed to empty.
        this.groups.set(UNGROUPED_ID, {
            id: UNGROUPED_ID,
            name: "未分組",
            color: "gray",
            collapsed: false,
            terminals: [],
        });
    }

    // --- Reads ---
    getGroups(): Group[] {
        return Array.from(this.groups.values());
    }
    getGroup(id: GroupId): Group | undefined { return this.groups.get(id); }
    getGroupOf(terminal: TerminalHandle): Group {
        const id = this.terminalToGroup.get(terminal) ?? UNGROUPED_ID;
        return this.groups.get(id)!;
    }
    aggregateUnseen(terminals: TerminalHandle[], isUnseen: (t: TerminalHandle) => boolean): number {
        let n = 0;
        for (const t of terminals) if (isUnseen(t)) n++;
        return n;
    }

    // --- Mutations ---
    createGroup(name: string, color: GroupColor = "blue"): Group {
        const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const g: Group = { id, name, color, collapsed: false, terminals: [] };
        this.groups.set(id, g);
        this.emit({ type: "groupAdded", group: g });
        return g;
    }

    renameGroup(id: GroupId, name: string): void {
        const g = this.groups.get(id);
        if (!g) return;
        if (g.name === name) return;
        g.name = name;
        this.emit({ type: "groupChanged", groupId: id });
    }

    setGroupColor(id: GroupId, color: GroupColor): void {
        const g = this.groups.get(id);
        if (!g || g.color === color) return;
        g.color = color;
        this.emit({ type: "groupChanged", groupId: id });
    }

    toggleGroupCollapsed(id: GroupId): void {
        const g = this.groups.get(id);
        if (!g) return;
        g.collapsed = !g.collapsed;
        this.emit({ type: "groupChanged", groupId: id });
    }

    deleteGroup(id: GroupId): void {
        if (id === UNGROUPED_ID) return; // never delete the default group
        const g = this.groups.get(id);
        if (!g) return;
        // Reassign all terminals back to UNGROUPED.
        for (const t of g.terminals) {
            this.terminalToGroup.set(t, UNGROUPED_ID);
            this.groups.get(UNGROUPED_ID)!.terminals.push(t);
        }
        g.terminals = [];
        this.groups.delete(id);
        this.emit({ type: "groupRemoved", groupId: id });
    }

    /** Idempotent. If terminal is already in a group, do nothing. */
    assignDefaultGroup(terminal: TerminalHandle): void {
        if (this.terminalToGroup.has(terminal)) return;
        this.terminalToGroup.set(terminal, UNGROUPED_ID);
        this.groups.get(UNGROUPED_ID)!.terminals.push(terminal);
        this.emit({ type: "terminalAssigned", terminal, groupId: UNGROUPED_ID });
    }

    removeTerminal(terminal: TerminalHandle): void {
        const id = this.terminalToGroup.get(terminal);
        if (!id) return;
        const g = this.groups.get(id);
        if (g) g.terminals = g.terminals.filter((t) => t !== terminal);
        this.terminalToGroup.delete(terminal);
        this.emit({ type: "terminalUnassigned", terminal });
    }

    /**
     * Move a terminal to a target group, optionally at a specific position.
     * - `position === undefined` → append to the end.
     * - `position === -1` → prepend.
     * - `position >= 0` → insert at that index.
     */
    moveTerminalToGroup(
        terminal: TerminalHandle,
        targetGroupId: GroupId,
        position?: number,
    ): void {
        const target = this.groups.get(targetGroupId);
        if (!target) return;
        const currentGroupId = this.terminalToGroup.get(terminal) ?? UNGROUPED_ID;
        if (currentGroupId === targetGroupId) {
            // Reorder within the same group.
            const list = target.terminals;
            const fromIdx = list.indexOf(terminal);
            if (fromIdx === -1) return;
            list.splice(fromIdx, 1);
            const insertAt = position === undefined
                ? list.length
                : Math.max(0, Math.min(position, list.length));
            list.splice(insertAt, 0, terminal);
        } else {
            // Cross-group move.
            const from = this.groups.get(currentGroupId);
            if (from) from.terminals = from.terminals.filter((t) => t !== terminal);
            const insertAt = position === undefined
                ? target.terminals.length
                : Math.max(0, Math.min(position, target.terminals.length));
            target.terminals.splice(insertAt, 0, terminal);
            this.terminalToGroup.set(terminal, targetGroupId);
        }
        this.emit({ type: "terminalAssigned", terminal, groupId: targetGroupId });
    }

    moveGroup(groupId: GroupId, targetIndex: number): void {
        if (groupId === UNGROUPED_ID) return; // keep default first
        const ids = Array.from(this.groups.keys());
        const from = ids.indexOf(groupId);
        if (from === -1) return;
        ids.splice(from, 1);
        const clamped = Math.max(1, Math.min(targetIndex, ids.length)); // never move above default
        ids.splice(clamped, 0, groupId);
        // Reconstruct map in new order.
        const reordered = new Map<GroupId, Group>();
        for (const id of ids) reordered.set(id, this.groups.get(id)!);
        this.groups = reordered;
        this.emit({ type: "groupOrderChanged" });
    }

    onDidChange(listener: GroupStoreListener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private emit(change: GroupStoreChange): void {
        for (const l of this.listeners) l(change);
    }
}
```

### 3. `src/treeSpec.ts` — add group spec; drop window spec

Keep `buildTreeItemSpec`, `stripUnseenPrefix`, and `UNSEEN_PREFIX` exactly as they are. Add a new pure function for groups; remove the unused `buildWindowGroupSpec` + `WindowGroupSpec`:

```ts
import type { Group } from "./groupStore";
import type { TerminalHandle } from "./types";

export type TreeIconKind = "default" | "highlighted";
export type GroupIconKind = "group" | "groupHighlighted";

export interface TreeItemSpec {
    label: string;
    iconKind: TreeIconKind;
    description?: string;
    command: { command: string; arguments: unknown[] };
    contextValue: "terminal";
}

export interface GroupSpec {
    id: string;                              // for TreeItem.id (preserve state)
    label: string;
    iconKind: GroupIconKind;
    description: string;                     // "N 個終端機有新輸出" or ""
    collapsibleState: "expanded" | "collapsed";
    contextValue: "group";
    /** Inline color tag rendered as `description`. */
    color: Group["color"];
}

export const UNSEEN_PREFIX = "● ";

export function stripUnseenPrefix(name: string): string { /* unchanged */ }
export function buildTreeItemSpec(terminal: TerminalHandle, opts: { isUnseen: boolean }): TreeItemSpec {
    /* unchanged */
}

export interface BuildGroupSpecOptions {
    unseenCount: number;
}

export function buildGroupSpec(group: Group, opts: BuildGroupSpecOptions): GroupSpec {
    return {
        id: `group:${group.id}`,
        label: group.name,
        iconKind: opts.unseenCount > 0 ? "groupHighlighted" : "group",
        description: opts.unseenCount > 0
            ? `● ${opts.unseenCount} 個新輸出`
            : "",
        collapsibleState: group.collapsed ? "collapsed" : "expanded",
        contextValue: "group",
        color: group.color,
    };
}
```

Color is rendered via a small inline tag in the description — VSCode's TreeItem doesn't have a native color swatch, but the description supports `string | boolean | undefined`. We use a leading emoji-square character mapped from `color` (e.g. `🟥 red`, `🟧 orange`, etc.) so the user sees a visible swatch. This stays inside a pure function returning a string, and the actual rendering decision lives in `getTreeItem`.

```ts
const COLOR_GLYPH: Record<Group["color"], string> = {
    red: "🟥", orange: "🟧", yellow: "🟨", green: "🟩",
    blue: "🟦", purple: "🟪", magenta: "🟪", gray: "⬜",
};
```

The label is rendered as `${COLOR_GLYPH[group.color]}  ${group.name}`; the description shows the unseen count.

### 4. `src/treeProvider.ts` — group-aware tree provider

Major rewrite. Generic over `Group | TerminalHandle`. Implements `getParent`. Subscribes to both registry and groupStore events.

```ts
import * as vscode from "vscode";
import type { TerminalHandle } from "./types";
import type { TerminalRegistry } from "./terminalRegistry";
import { GroupStore, type Group } from "./groupStore";
import { buildTreeItemSpec, buildGroupSpec } from "./treeSpec";

type TreeElement = Group | TerminalHandle;

const DEFAULT_REFRESH_INTERVAL_MS = 3000;

export class TerminalTreeProvider implements vscode.TreeDataProvider<TreeElement> {
    private readonly emitter = new vscode.EventEmitter<TreeElement | TreeElement[] | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;
    private unsubscribeRegistry?: () => void;
    private unsubscribeGroupStore?: () => void;
    private refreshTimer?: ReturnType<typeof setInterval>;
    private unseen = new Set<TerminalHandle>();
    private expanded = new Set<string>();   // group ids the user has expanded; collapse toggling

    constructor(
        private readonly registry: TerminalRegistry,
        private readonly groupStore: GroupStore,
        private readonly refreshIntervalMs: number = DEFAULT_REFRESH_INTERVAL_MS,
    ) {}

    start(): void {
        if (this.unsubscribeRegistry) return;
        this.refreshUnseenSet();
        this.unsubscribeRegistry = this.registry.onDidChange((change) => {
            if (change.type === "unseenChanged") {
                if (change.hasUnseenOutput) this.unseen.add(change.terminal);
                else this.unseen.delete(change.terminal);
                // The terminal AND its parent group both need a refresh so
                // the aggregate count updates.
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
                    this.emitter.fire(this.groupStore.getGroup(change.groupId));
                    break;
            }
        });

        if (this.refreshIntervalMs > 0) {
            this.refreshTimer = setInterval(() => this.emitter.fire(undefined), this.refreshIntervalMs);
        }
    }

    stop(): void {
        this.unsubscribeRegistry?.(); this.unsubscribeRegistry = undefined;
        this.unsubscribeGroupStore?.(); this.unsubscribeGroupStore = undefined;
        if (this.refreshTimer !== undefined) {
            clearInterval(this.refreshTimer); this.refreshTimer = undefined;
        }
    }

    refresh(): void { this.emitter.fire(undefined); }

    getTreeItem(element: TreeElement): vscode.TreeItem {
        if (this.isGroup(element)) return this.buildGroupTreeItem(element);
        return this.buildTerminalTreeItem(element);
    }

    getChildren(element?: TreeElement): TreeElement[] {
        if (!element) return this.groupStore.getGroups();
        if (this.isGroup(element)) return element.terminals;
        return [];
    }

    getParent(element: TreeElement): TreeElement | undefined {
        if (this.isGroup(element)) return undefined;
        return this.groupStore.getGroupOf(element);
    }

    private isGroup(e: TreeElement): e is Group {
        return typeof (e as Group).id === "string" && Array.isArray((e as Group).terminals);
    }

    private buildGroupTreeItem(group: Group): vscode.TreeItem {
        const unseenCount = this.groupStore.aggregateUnseen(group.terminals, (t) => this.unseen.has(t));
        const spec = buildGroupSpec(group, { unseenCount });
        const item = new vscode.TreeItem(spec.label);
        item.id = spec.id;
        item.description = spec.description;
        item.iconPath = new vscode.ThemeIcon(
            spec.iconKind === "groupHighlighted" ? "folder-active" : "folder",
            new vscode.ThemeColor(`charts.${spec.color === "magenta" ? "purple" : spec.color}`)
        );
        item.collapsibleState = spec.collapsibleState === "expanded"
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        item.contextValue = spec.contextValue;
        return item;
    }

    private buildTerminalTreeItem(terminal: TerminalHandle): vscode.TreeItem {
        const spec = buildTreeItemSpec(terminal, { isUnseen: this.unseen.has(terminal) });
        const item = new vscode.TreeItem(spec.label);
        item.description = spec.description;
        item.iconPath = new vscode.ThemeIcon(
            spec.iconKind === "highlighted" ? "circle-filled" : "terminal",
            spec.iconKind === "highlighted" ? new vscode.ThemeColor("charts.yellow") : undefined
        );
        item.command = { command: spec.command.command, title: "Focus Terminal", arguments: spec.command.arguments };
        item.contextValue = spec.contextValue;
        return item;
    }

    private refreshUnseenSet(): void {
        this.unseen = new Set(this.registry.getUnseen());
    }
}

export { UNSEEN_PREFIX, stripUnseenPrefix } from "./treeSpec";
```

### 5. `src/extension.ts` — wire GroupStore, drag-and-drop, and new commands

Updates:

- Construct `GroupStore` alongside `TerminalRegistry`.
- Pass both to `TerminalTreeProvider`.
- Build a `TreeDragAndDropController` and pass it to `createTreeView`.
- Register new commands: `superset.newGroup`, `superset.renameGroup`, `superset.setGroupColor`, `superset.deleteGroup`, `superset.toggleGroupCollapsed`.
- For pre-populated terminals on startup, call `groupStore.assignDefaultGroup(t)`.

```ts
import * as vscode from "vscode";
import { GroupStore, UNGROUPED_ID, type GroupColor } from "./groupStore";
// ... existing imports

export function activate(context: vscode.ExtensionContext): void {
    const registry = new TerminalRegistry();
    const groupStore = new GroupStore();
    // ... existing setup

    // Pre-populate both registry and group store.
    for (const terminal of vscode.window.terminals) {
        registry.add(terminal);
        groupStore.assignDefaultGroup(terminal);
    }

    const treeProvider = new TerminalTreeProvider(registry, groupStore);
    treeProvider.start();
    subscriptions.push({ dispose: () => treeProvider.stop() });

    // Drag and drop controller.
    const dragAndDropController: vscode.TreeDragAndDropController<TreeElement> = {
        dragMimeTypes: ["application/vnd.code.tree.superset.terminals/dnd"],
        dropMimeTypes: ["application/vnd.code.tree.superset.terminals/dnd"],
        handleDrag: (source, dataTransfer) => {
            for (const item of source) {
                if (isGroup(item)) {
                    dataTransfer.set("application/vnd.code.tree.superset.terminals/dnd",
                        new vscode.DataTransferItem({ kind: "group", id: item.id }));
                } else {
                    dataTransfer.set("application/vnd.code.tree.superset.terminals/dnd",
                        new vscode.DataTransferItem({ kind: "terminal", terminal: item }));
                }
            }
        },
        handleDrop: (target, dataTransfer) => {
            const dropped: DataTransferItem[] = [];
            dataTransfer.forEach((item) => dropped.push(item));
            for (const item of dropped) {
                const value = item.value as { kind: "group" | "terminal"; id?: string; terminal?: TerminalHandle };
                if (value.kind === "terminal" && value.terminal) {
                    const targetGroupId = isGroup(target) ? target.id : UNGROUPED_ID;
                    groupStore.moveTerminalToGroup(value.terminal, targetGroupId);
                } else if (value.kind === "group" && value.id) {
                    groupStore.moveGroup(value.id, groupStore.getGroups().length - 1);
                }
            }
            treeProvider.refresh();
        },
    };

    const treeView = vscode.window.createTreeView("superset.terminals", {
        treeDataProvider: treeProvider,
        dragAndDropController,
        showCollapseAll: true,
    });
    // ... existing title/windowTag logic

    // New group command
    subscriptions.push(vscode.commands.registerCommand("superset.newGroup", async () => {
        const name = await vscode.window.showInputBox({ prompt: "群組名稱", value: "" });
        if (!name) return;
        groupStore.createGroup(name);
    }));

    subscriptions.push(vscode.commands.registerCommand("superset.renameGroup", async (group: Group | undefined) => {
        if (!group) return;
        const name = await vscode.window.showInputBox({ prompt: "新名稱", value: group.name });
        if (!name) return;
        groupStore.renameGroup(group.id, name);
    }));

    subscriptions.push(vscode.commands.registerCommand("superset.setGroupColor", async (group: Group | undefined) => {
        if (!group) return;
        const color = await vscode.window.showQuickPick(
            ["red","orange","yellow","green","blue","purple","magenta","gray"] as GroupColor[],
            { placeHolder: "選擇顏色" }
        );
        if (!color) return;
        groupStore.setGroupColor(group.id, color);
    }));

    subscriptions.push(vscode.commands.registerCommand("superset.deleteGroup", (group: Group | undefined) => {
        if (!group || group.id === UNGROUPED_ID) return;
        groupStore.deleteGroup(group.id);
    }));

    subscriptions.push(vscode.commands.registerCommand("superset.toggleGroupCollapsed", (group: Group | undefined) => {
        if (!group) return;
        groupStore.toggleGroupCollapsed(group.id);
    }));
}

function isGroup(e: unknown): e is Group {
    return typeof (e as Group)?.id === "string" && Array.isArray((e as Group)?.terminals);
}
```

The pre-population block changes to call both `registry.add` and `groupStore.assignDefaultGroup`. The `onDidOpenTerminal` handler still calls `registry.add`; the treeProvider's `start()` will pick up the `added` event and assign the default group automatically. The explicit pre-populate path is for the initial sync of already-open terminals on activation.

### 6. `package.json` — register new commands, menus, view/title button

Add to `contributes.commands`:

```json
{
    "command": "superset.newGroup",
    "title": "Superset: New Group",
    "icon": "$(add)"
},
{
    "command": "superset.renameGroup",
    "title": "Superset: Rename Group"
},
{
    "command": "superset.setGroupColor",
    "title": "Superset: Set Group Color"
},
{
    "command": "superset.deleteGroup",
    "title": "Superset: Delete Group"
},
{
    "command": "superset.toggleGroupCollapsed",
    "title": "Superset: Toggle Group"
}
```

Add to `menus.view.title`:

```json
{
    "command": "superset.newGroup",
    "when": "view == superset.terminals",
    "group": "navigation"
}
```

Add to `menus.view.item.context` (gated on the new `group` context value):

```json
{ "command": "superset.toggleGroupCollapsed", "when": "viewItem == group", "group": "inline" },
{ "command": "superset.renameGroup",        "when": "viewItem == group", "group": "1_group" },
{ "command": "superset.setGroupColor",      "when": "viewItem == group", "group": "1_group" },
{ "command": "superset.deleteGroup",        "when": "viewItem == group && viewItem != ungroupedGroup", "group": "9_group" }
```

The `ungroupedGroup` context value is set on the default group by the tree provider (a `contextValue` of `group:ungrouped`), and the `delete` command's `when` clause refuses to fire for it.

### 7. `test/groupStore.test.ts` (new) — pure unit tests

Covers all the GroupStore methods without touching vscode:

- `createGroup` emits `groupAdded` and inserts at the end
- `assignDefaultGroup` is idempotent and goes to UNGROUPED
- `removeTerminal` clears the reverse map and removes from the group list
- `moveTerminalToGroup` to the same group reorders; to a different group moves
- `moveGroup` keeps UNGROUPED first
- `deleteGroup` reassigns terminals back to UNGROUPED
- `deleteGroup(UNGROUPED_ID)` is a no-op
- `aggregateUnseen` counts correctly with a fake `isUnseen` predicate
- `onDidChange` unsubscribe works

Test pattern mirrors `test/terminalRegistry.test.ts` exactly. Reuses the same `fakeTerminal` helper (defined inline in this test file).

### 8. `test/treeProvider.test.ts` — extend for `buildGroupSpec`

Keep all 5 existing cases for `buildTreeItemSpec`. Add cases for `buildGroupSpec`:

- label is the color glyph + group name
- description is empty when no unseen
- description is `● N 個新輸出` when unseen > 0
- iconKind is `groupHighlighted` only when unseen > 0
- collapsibleState mirrors `group.collapsed`
- contextValue is `"group"` and `id` is stable

### 9. `test/extension.test.ts` (new, optional) — smoke test for the drag-and-drop payload shape

Vitest can import the file if we expose a small pure function for the drop dispatch (extract `dispatchDrop(target, items, groupStore)` into `src/dropDispatch.ts` for testability). This is a stretch goal; not required for the first cut.

## Edge Cases

1. **Dragging a group onto its own subtree** — `moveGroup(groupId, ...)` short-circuits because the source id is already in the list; `splice(from, 1)` + `splice(to, 0, ...)` becomes a no-op.
2. **Dragging a group above the default** — `moveGroup` clamps `targetIndex` to `Math.max(1, ...)` so UNGROUPED stays at index 0.
3. **Dropping a terminal on the root** — `target === undefined`; we treat that as "drop on UNGROUPED".
4. **Default group delete attempt** — both the menu `when` clause and `deleteGroup` itself refuse `UNGROUPED_ID`.
5. **Terminal removed from registry while the group still references it** — `groupStore.removeTerminal` is called from the `removed` event handler in the tree provider. A terminal that gets force-disposed externally is also reaped because `onDidCloseTerminal` fires `registry.remove`.
6. **Group with zero terminals after move** — fine; the group stays visible (collapsed or expanded, as set) until the user deletes it.
7. **Name uniqueness / whitespace** — names are free-form text; the spec allows duplicates and trims via the input box (VSCode `showInputBox` returns `undefined` for empty values; we accept any non-empty string verbatim).
8. **Drag from collapsed group** — VSCode only allows dragging visible elements; the user must expand the group first. We do nothing special.
9. **A group with all-unseen children** — its `unseenCount` is `group.terminals.length`; description becomes `● N 個新輸出`.
10. **Refresh tick** — the 3-second polling tick still fires `onDidChangeTreeData(undefined)`. The tree view re-asks for `getChildren(undefined)` and rebuilds; the existing `Terminal.name` rename case continues to work.

## Verification

1. **Type check**: `npx tsc --noEmit` clean. The new `Group` is structurally compatible with the `TreeElement` constraint; `getParent` returns `undefined` for groups, which is allowed by the interface.
2. **Existing tests**: `npm test` — the 57 prior cases pass unchanged. New cases in `groupStore.test.ts` (+12) and `treeProvider.test.ts` (+6) bring the total to ~75.
3. **Build**: `npm run build` → `out/extension.js` produced. `npx @vscode/vsce package` → `.vsix` produced with no `enabledApiProposals` warnings (drag-and-drop is stable API).
4. **Manual test in Extension Development Host (`F5`)**:
   - Open the panel — see **未分組** with all open terminals.
   - Click `+` next to **New Terminal** → input box → name "Frontend" → group appears below 未分組.
   - Drag a terminal from 未分組 into Frontend — terminal moves.
   - Drag Frontend above 未分組 — refuses (clamped).
   - Drag a terminal within Frontend to reorder.
   - Right-click Frontend → Rename → "Frontend (prod)".
   - Right-click Frontend → Set Color → yellow.
   - Open a TUI terminal in the background, switch to another — Frontend's unseen count stays at 0; the group with the active terminal shows the count correctly.
   - Right-click 未分組 → Delete is **not** offered; trying the command via the command palette does nothing.
5. **Persistence**: groups are session-scoped (no `ExtensionContext.globalState` writes in v1; this matches the existing "no persistence" stance of the panel). A reload returns to a single 未分組 group. If persistence is needed later, add a `memento` save/load in `activate()` and apply to `groupStore.createGroup` calls.
6. **Performance**: with ~30 groups and ~100 terminals, drag-and-drop fires one `onDidChangeTreeData(undefined)` and the tree re-queries `getChildren(undefined)` (returns ~30 groups) plus the affected group's children. No O(n²) anywhere.
7. **Status bar regression**: the global "N 個終端機有新輸出" status bar still works because `HighlightPresenter` is unchanged.

## Risks

- **VSCode auto-mime**: VSCode adds `application/vnd.code.tree.superset.terminals` to the drag transfer automatically. Our custom `dnd` suffix is a defensive parallel; we read whichever the dataTransfer exposes in `handleDrop`. If VSCode ever changes auto-mime behavior, the code still works because we use `dataTransfer.forEach` to enumerate all items.
- **`getParent` requirement**: the new `getParent` returns `undefined` for groups, which is the documented value for "root children". `TreeView.reveal()` works.
- **Color rendering**: `charts.red` / `charts.yellow` / etc. are valid ThemeColor keys. Some color names in the palette (`magenta`) don't have a direct `charts.magenta` — we map `magenta → charts.purple` in the icon theme color, but keep the user's color string in the data so the description glyph stays correct.
- **The `WindowGroupNode` removal**: there are no live references in the codebase other than the type definition and the unused `buildWindowGroupSpec`. No tests reference either. Safe to remove.
- **Drag-and-drop on a flat list semantics**: VSCode's stable API does not expose cursor position during a drop. Our dispatch rule is "drop on a terminal = insert after it; drop on a group = append to that group; drop on root = append to UNGROUPED". This is the same heuristic that VSCode's built-in tree views use, and it matches user expectations for "drop here to put it in this group".

## Critical Files for Implementation

- /Users/bytedance/projects/superset/src/types.ts
- /Users/bytedance/projects/superset/src/groupStore.ts (new)
- /Users/bytedance/projects/superset/src/treeSpec.ts
- /Users/bytedance/projects/superset/src/treeProvider.ts
- /Users/bytedance/projects/superset/src/extension.ts
- /Users/bytedance/projects/superset/package.json
