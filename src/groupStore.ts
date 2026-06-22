import type { TerminalHandle } from "./types";

export const UNGROUPED_ID = "ungrouped" as const;
export type GroupId = string;

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
    | { type: "groupChanged"; groupId: GroupId }
    | { type: "groupOrderChanged" }
    | { type: "terminalAssigned"; terminal: TerminalHandle; groupId: GroupId }
    | { type: "terminalUnassigned"; terminal: TerminalHandle };

export type GroupStoreListener = (change: GroupStoreChange) => void;

/**
 * Pure data layer for terminal grouping. No `vscode` imports.
 * Owns group membership, ordering, names, colors, and collapse state.
 *
 * The existing `TerminalRegistry` stays untouched as the source of truth
 * for terminal presence + unseen flags; this store merely maps
 * `TerminalHandle → GroupId` and exposes a sorted projection for the tree.
 */
export class GroupStore {
    private groups = new Map<GroupId, Group>();
    private terminalToGroup = new Map<TerminalHandle, GroupId>();
    private listeners = new Set<GroupStoreListener>();

    constructor() {
        this.groups.set(UNGROUPED_ID, {
            id: UNGROUPED_ID,
            name: "未分組",
            color: "gray",
            collapsed: false,
            terminals: [],
        });
    }

    // ── Reads ──────────────────────────────────────────────

    getGroups(): Group[] {
        return Array.from(this.groups.values());
    }

    getGroup(id: GroupId): Group | undefined {
        return this.groups.get(id);
    }

    getGroupOf(terminal: TerminalHandle): Group {
        const id = this.terminalToGroup.get(terminal) ?? UNGROUPED_ID;
        return this.groups.get(id)!;
    }

    aggregateUnseen(
        terminals: TerminalHandle[],
        isUnseen: (t: TerminalHandle) => boolean
    ): number {
        let n = 0;
        for (const t of terminals) {
            if (isUnseen(t)) n++;
        }
        return n;
    }

    // ── Group mutations ────────────────────────────────────

    createGroup(name: string, color: GroupColor = "blue"): Group {
        const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const g: Group = { id, name, color, collapsed: false, terminals: [] };
        this.groups.set(id, g);
        this.emit({ type: "groupAdded", group: g });
        return g;
    }

    renameGroup(id: GroupId, name: string): void {
        const g = this.groups.get(id);
        if (!g || g.name === name) return;
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
        if (id === UNGROUPED_ID) return;
        const g = this.groups.get(id);
        if (!g) return;
        for (const t of g.terminals) {
            this.terminalToGroup.set(t, UNGROUPED_ID);
            this.groups.get(UNGROUPED_ID)!.terminals.push(t);
        }
        g.terminals = [];
        this.groups.delete(id);
        this.emit({ type: "groupRemoved", groupId: id });
    }

    // ── Terminal membership ────────────────────────────────

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
        if (g) {
            g.terminals = g.terminals.filter((t) => t !== terminal);
        }
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
        position?: number
    ): void {
        const target = this.groups.get(targetGroupId);
        if (!target) return;
        const currentGroupId = this.terminalToGroup.get(terminal) ?? UNGROUPED_ID;

        if (currentGroupId === targetGroupId) {
            const list = target.terminals;
            const fromIdx = list.indexOf(terminal);
            if (fromIdx === -1) return;
            list.splice(fromIdx, 1);
            const insertAt =
                position === undefined
                    ? list.length
                    : Math.max(0, Math.min(position, list.length));
            list.splice(insertAt, 0, terminal);
        } else {
            const from = this.groups.get(currentGroupId);
            if (from) {
                from.terminals = from.terminals.filter((t) => t !== terminal);
            }
            const insertAt =
                position === undefined
                    ? target.terminals.length
                    : Math.max(0, Math.min(position, target.terminals.length));
            target.terminals.splice(insertAt, 0, terminal);
            this.terminalToGroup.set(terminal, targetGroupId);
        }
        this.emit({ type: "terminalAssigned", terminal, groupId: targetGroupId });
    }

    // ── Group ordering ─────────────────────────────────────

    moveGroup(groupId: GroupId, targetIndex: number): void {
        if (groupId === UNGROUPED_ID) return;
        const ids = Array.from(this.groups.keys());
        const from = ids.indexOf(groupId);
        if (from === -1) return;
        ids.splice(from, 1);
        const clamped = Math.max(1, Math.min(targetIndex, ids.length));
        ids.splice(clamped, 0, groupId);
        const reordered = new Map<GroupId, Group>();
        for (const id of ids) {
            reordered.set(id, this.groups.get(id)!);
        }
        this.groups = reordered;
        this.emit({ type: "groupOrderChanged" });
    }

    // ── Events ─────────────────────────────────────────────

    onDidChange(listener: GroupStoreListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(change: GroupStoreChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }
}