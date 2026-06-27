import type { Group, GroupColor } from "./groupStore";
import type { TerminalHandle } from "./types";

export type TreeIconKind = "default" | "highlighted";
export type GroupIconKind = "group" | "groupHighlighted";

export interface TreeItemSpec {
    label: string;
    iconKind: TreeIconKind;
    description?: string;
    command: { command: string; arguments: unknown[] };
    /**
     * Discriminator for the inline close menu. `menus.view.item.context`
     * in package.json matches `viewItem == "terminal"`; keep in sync.
     */
    contextValue: "terminal";
}

export interface GroupSpec {
    /** Stable id for `TreeItem.id` so collapse/expand survives refresh. */
    id: string;
    label: string;
    iconKind: GroupIconKind;
    description: string;
    collapsibleState: "expanded" | "collapsed";
    contextValue: "group";
    color: GroupColor;
}

export const UNSEEN_PREFIX = "● ";

/** Color glyphs rendered as the first character of the group label. */
export const COLOR_GLYPH: Record<GroupColor, string> = {
    red: "🟥",
    orange: "🟧",
    yellow: "🟨",
    green: "🟩",
    blue: "🟦",
    purple: "🟪",
    magenta: "🟪",
    gray: "⬜",
};

export interface BuildTreeItemSpecOptions {
    isUnseen: boolean;
}

export interface BuildGroupSpecOptions {
    unseenCount: number;
}

/**
 * Strip the leading "● " prefix the presenter may have applied.
 * Only matches at position 0; mid-name occurrences are preserved.
 */
export function stripUnseenPrefix(name: string): string {
    return name.startsWith(UNSEEN_PREFIX)
        ? name.slice(UNSEEN_PREFIX.length)
        : name;
}

export function buildTreeItemSpec(
    terminal: TerminalHandle,
    opts: BuildTreeItemSpecOptions
): TreeItemSpec {
    return {
        label: stripUnseenPrefix(terminal.name),
        iconKind: opts.isUnseen ? "highlighted" : "default",
        description: opts.isUnseen ? "● 新輸出" : undefined,
        command: {
            command: "superset.focus",
            arguments: [terminal],
        },
        contextValue: "terminal",
    };
}

export function buildGroupSpec(
    group: Group,
    opts: BuildGroupSpecOptions
): GroupSpec {
    return {
        id: `group:${group.id}`,
        label: `${COLOR_GLYPH[group.color]}  ${group.name}`,
        iconKind: opts.unseenCount > 0 ? "groupHighlighted" : "group",
        description:
            opts.unseenCount > 0
                ? `● ${opts.unseenCount} 個新輸出`
                : "",
        collapsibleState: group.collapsed ? "collapsed" : "expanded",
        contextValue: "group",
        color: group.color,
    };
}