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
        const unseen = new Set(this.deps.registry.getUnseen());
        for (const terminal of this.deps.registry.getAll()) {
            this.applyPrefix(terminal, unseen.has(terminal));
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
        this.deps.setTerminalName(terminal, target);
    }

    private refreshStatusBar(): void {
        const count = this.deps.registry.getUnseen().length;
        if (count === 0) {
            this.deps.setStatusBarText("");
            this.deps.hideStatusBar();
        } else {
            this.deps.setStatusBarText(
                count === 1
                    ? "1 個終端機有新輸出"
                    : `${count} 個終端機有新輸出`
            );
            this.deps.showStatusBar();
        }
    }
}