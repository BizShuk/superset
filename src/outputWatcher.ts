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
            // Defensive: ignore terminals the registry doesn't know about.
            if (!this.deps.registry.has(terminal)) {
                return;
            }
            execution.onData(() => {
                if (this.deps.getActiveTerminal() === terminal) {
                    return;
                }
                this.deps.registry.markUnseen(terminal);
            });
        });
    }

    stop(): void {
        this.dispose?.();
        this.dispose = undefined;
    }
}
