export interface TerminalHandle {
    readonly name: string;
    show(): void;
    /** Kill the terminal process and remove it from the dashboard. */
    dispose(): void;
}

/**
 * A pseudo-node representing the single window this dashboard lives in.
 * TreeDataProvider renders it as the parent of all terminal leaves.
 * Multi-window enumeration is not supported by the VSCode API; this
 * node exists purely for visual grouping.
 */
export interface WindowGroupNode {
    kind: "window";
    tag: string;
}

/** Tree element is either a window group (parent) or a terminal (leaf). */
export type TreeElement = WindowGroupNode | TerminalHandle;

export type RegistryChange =
    | { type: "added"; terminal: TerminalHandle }
    | { type: "removed"; terminal: TerminalHandle }
    | {
          type: "unseenChanged";
          terminal: TerminalHandle;
          hasUnseenOutput: boolean;
      };

export type RegistryListener = (change: RegistryChange) => void;
