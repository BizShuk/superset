import type { TerminalHandle, WindowGroupNode } from "./types";

export type TreeIconKind = "default" | "highlighted";

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

/**
 * Spec for the parent (window group) node. Carries no command — clicking
 * the header just toggles expansion. Kept as a separate interface so the
 * terminal and window specs don't share a discriminator accidentally.
 */
export interface WindowGroupSpec {
    label: string;
    iconKind: "window";
    collapsibleState: "expanded" | "collapsed";
    contextValue: "windowGroup";
}

export const UNSEEN_PREFIX = "● ";

export interface BuildTreeItemSpecOptions {
    isUnseen: boolean;
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

/**
 * Build the parent window-group spec. The 8-char tag is a short session
 * id (see extension.ts) — enough to disambiguate on a single machine.
 */
export function buildWindowGroupSpec(node: WindowGroupNode): WindowGroupSpec {
    return {
        label: `Window: ${node.tag}`,
        iconKind: "window",
        // Default expanded: user opens the panel to see terminals; an
        // extra click to unfold would be friction.
        collapsibleState: "expanded",
        contextValue: "windowGroup",
    };
}
