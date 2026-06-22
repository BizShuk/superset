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
     * Optional diagnostic sink. Used to surface the tab-name prefix
     * fallback decision (see applyPrefix), since the failure is silent
     * at the user-facing level once we degrade.
     */
    log?: (msg: string) => void;
}

export class HighlightPresenter {
    private unsubscribe?: () => void;
    /**
     * In VSCode 1.90+ `Terminal.name` is a getter-only property and the
     * `(terminal as unknown as { name: string })` cast throws at runtime.
     * Detect this on the first failed write and fall back to the panel +
     * status-bar channels for the rest of the session.
     */
    private nameWriteSupported = true;

    constructor(private readonly deps: HighlightPresenterDeps) {}

    start(): void {
        if (this.unsubscribe) {
            return;
        }
        // Reset the per-session flag on each start: the VSCode runtime may
        // have changed across reloads (version update, window restart), so
        // we re-attempt the name-setter path instead of staying degraded
        // forever once it fails once.
        this.nameWriteSupported = true;
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
        // Once we've seen a setter throw, stop trying — the rest of the
        // highlight chain (panel + status bar) still works.
        if (!this.nameWriteSupported) {
            return;
        }
        const current = terminal.name;
        const bare = stripUnseenPrefix(current);
        const target = isUnseen ? `${UNSEEN_PREFIX}${bare}` : bare;
        if (current === target) {
            return;
        }
        try {
            this.deps.setTerminalName(terminal, target);
        } catch (err) {
            this.nameWriteSupported = false;
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