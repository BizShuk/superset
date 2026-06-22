export interface TerminalHandle {
    readonly name: string;
    show(): void;
    /** Kill the terminal process and remove it from the dashboard. */
    dispose(): void;
}

export type RegistryChange =
    | { type: "added"; terminal: TerminalHandle }
    | { type: "removed"; terminal: TerminalHandle }
    | {
          type: "unseenChanged";
          terminal: TerminalHandle;
          hasUnseenOutput: boolean;
      };

export type RegistryListener = (change: RegistryChange) => void;