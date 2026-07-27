// Activity source `B`: shell-integration lifecycle events.
//
// Uses `onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`
// and deliberately never calls `execution.read()`. Reading the stream is what
// makes the existing `OutputWatcher` expensive: it drains every byte through
// the extension host and (before this change) JSON-stringified each chunk into
// the diagnostic channel. The start/end events alone carry the signal we need
// — a command began, a command finished — at zero bytes.
//
// No `vscode` import: the two event subscriptions are injected so the policy
// is unit-testable. The adapter that binds them to the real API lives in
// `shellExecutionSource.ts`.

import type { ActivitySource } from "./activitySource";
import type { TerminalHandle } from "./types";

export interface ShellExecutionLifecycleEvent {
    readonly terminal: TerminalHandle;
    /** Optional source metadata. Activity reasons deliberately ignore it. */
    readonly commandLine?: string;
    /** Exit code, present on end events when the shell reported one. */
    readonly exitCode?: number;
}

export type LifecycleSubscriber = (
    cb: (event: ShellExecutionLifecycleEvent) => void
) => () => void;

export interface ShellIntegrationActivitySourceDeps {
    readonly onDidStart: LifecycleSubscriber;
    readonly onDidEnd: LifecycleSubscriber;
    readonly log?: (msg: string) => void;
}

/**
 * Emit activity on both ends of a shell execution.
 *
 * Both edges matter and they mean different things:
 * - `start` — a command was launched in a terminal the user is not watching.
 *   Worth a highlight: something is now happening over there.
 * - `end` — the command finished. This is the stronger signal of the two;
 *   it is the moment a background build or test run becomes worth looking at.
 *
 * Whether either actually flips the badge is not decided here — the
 * coordinator suppresses events for the focused and recently-focused
 * terminals.
 */
export function createShellIntegrationActivitySource(
    deps: ShellIntegrationActivitySourceDeps
): ActivitySource {
    return (emit) => {
        const offStart = deps.onDidStart((event) => {
            emit({
                terminal: event.terminal,
                reason: "shell: started",
            });
        });
        const offEnd = deps.onDidEnd((event) => {
            const code =
                event.exitCode === undefined ? "" : ` exit=${event.exitCode}`;
            emit({
                terminal: event.terminal,
                reason: `shell: finished${code}`,
            });
        });
        return () => {
            try {
                offStart();
            } catch (err) {
                deps.log?.(`[activity:shell] unsubscribe start error: ${err}`);
            }
            try {
                offEnd();
            } catch (err) {
                deps.log?.(`[activity:shell] unsubscribe end error: ${err}`);
            }
        };
    };
}
