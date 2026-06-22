import type { TerminalHandle } from "./types";
import type { TerminalRegistry } from "./terminalRegistry";

export interface ShellExecutionLike {
    onData(cb: (data: string) => void): void;
}

export interface ShellExecutionStartEvent {
    terminal: TerminalHandle;
    execution: ShellExecutionLike;
}

export interface OutputWatcherDeps {
    registry: TerminalRegistry;
    getActiveTerminal: () => TerminalHandle | undefined;
    onShellExecution: (
        cb: (event: ShellExecutionStartEvent) => void
    ) => () => void;
    /**
     * If true for a terminal, the watcher suppresses markUnseen — the user
     * was just in that terminal and trailing output is expected.
     */
    isRecentlyActive?: (terminal: TerminalHandle) => boolean;
    /**
     * Optional diagnostic sink. Receives one human-readable line per
     * meaningful decision the watcher makes, used to trace why the
     * unseen-highlight chain failed in a user's environment.
     */
    log?: (msg: string) => void;
}

export class OutputWatcher {
    constructor(private readonly deps: OutputWatcherDeps) {}

    private dispose?: () => void;

    start(): void {
        if (this.dispose) {
            return;
        }
        this.dispose = this.deps.onShellExecution((event) => {
            const { terminal, execution } = event;
            const log = this.deps.log;
            if (!this.deps.registry.has(terminal)) {
                log?.(`[watcher] skip "${terminal.name}": not in registry`);
                return;
            }
            log?.(`[watcher] wire data listener for "${terminal.name}"`);
            let firstChunk = true;
            execution.onData(() => {
                const active = this.deps.getActiveTerminal();
                if (active === terminal) {
                    if (firstChunk) {
                        log?.(
                            `[watcher] skip "${terminal.name}": is active terminal`
                        );
                    }
                    return;
                }
                if (this.deps.isRecentlyActive?.(terminal)) {
                    if (firstChunk) {
                        log?.(
                            `[watcher] skip "${terminal.name}": was recently active`
                        );
                    }
                    return;
                }
                firstChunk = false;
                log?.(
                    `[watcher] markUnseen("${terminal.name}") ` +
                        `active="${active?.name ?? "<none>"}"`
                );
                this.deps.registry.markUnseen(terminal);
            });
        });
    }

    stop(): void {
        this.dispose?.();
        this.dispose = undefined;
    }
}
