import { stripUnseenPrefix, UNSEEN_PREFIX } from "./treeSpec";
import type { TerminalRegistry } from "./terminalRegistry";
import type { TerminalHandle } from "./types";

export { UNSEEN_PREFIX };

export interface HighlightPresenterDeps {
    registry: TerminalRegistry;
    setTerminalName: (terminal: TerminalHandle, name: string) => void;
    setStatusBarText: (text: string) => void;
    showStatusBar: () => void;
    hideStatusBar: () => void;
    /**
     * Optional. When provided, the presenter calls this on every
     * `showStatusBar` (and `clearStatusBarCommand` on `hideStatusBar`)
     * so the extension can wire / unwire a click command on the
     * underlying status bar item. Kept as a parameterless callback so
     * the presenter doesn't have to know which command to bind — that
     * knowledge lives at the call site (extension.ts).
     *
     * VSCode keeps a status bar item's `command` even when the item is
     * hidden, so a stale click target would surface a "run command"
     * tooltip on hover for no reason. Always clear on hide.
     */
    setStatusBarCommand?: () => void;
    clearStatusBarCommand?: () => void;
    /**
     * Optional diagnostic sink. Used to surface the tab-name prefix
     * fallback decision (see applyPrefix), since the failure is silent
     * at the user-facing level once we degrade.
     */
    log?: (msg: string) => void;
}

export class HighlightPresenter {
    private unsubscribe?: () => void;

    constructor(private readonly deps: HighlightPresenterDeps) {}

    start(): void {
        if (this.unsubscribe) {
            return;
        }
        // Reapply prefixes to match the registry's current state. We do
        // not touch the status bar here — it's already hidden by default
        // and a freshly-populated registry has no unseen entries.
        const unseen = new Set(
            this.deps.registry.getUnseen().map((e) => e.terminal)
        );
        for (const entry of this.deps.registry.getAll()) {
            this.applyPrefix(entry.terminal, unseen.has(entry.terminal));
        }
        this.unsubscribe = this.deps.registry.onDidChange((change) => {
            if (change.type === "added") {
                this.applyPrefix(change.terminal, false);
                return;
            }
            if (change.type === "removed") {
                this.refreshStatusBar();
                return;
            }
            if (change.type === "unseenChanged") {
                this.applyPrefix(change.terminal, change.hasUnseenOutput);
                this.refreshStatusBar();
            }
        });
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    private applyPrefix(terminal: TerminalHandle, isUnseen: boolean): void {
        const current = terminal.name;
        const bare = stripUnseenPrefix(current);
        const target = isUnseen ? `${UNSEEN_PREFIX}${bare}` : bare;
        if (current === target) {
            return;
        }
        try {
            this.deps.setTerminalName(terminal, target);
        } catch (err) {
            this.deps.log?.(
                `[presenter] terminal.name is read-only in this VSCode; ` +
                    `tab-name prefix disabled (panel + status bar still active): ${err}`
            );
        }
    }

    private refreshStatusBar(): void {
        const count = this.deps.registry.getUnseen().length;
        if (count === 0) {
            this.deps.setStatusBarText("");
            // Clear the click binding when the item hides — see the
            // deps docstring for why VSCode's residual binding is
            // observable to the user.
            this.deps.clearStatusBarCommand?.();
            this.deps.hideStatusBar();
        } else {
            this.deps.setStatusBarText(
                count === 1
                    ? "1 個終端機有新輸出"
                    : `${count} 個終端機有新輸出`
            );
            // Show + click-bind in the same branch: a visible status
            // bar notification MUST be clickable, and a clickable one
            // MUST be visible. Splitting them across refresh calls
            // risks a half-rendered state on fast unseen transitions.
            this.deps.setStatusBarCommand?.();
            this.deps.showStatusBar();
        }
    }
}