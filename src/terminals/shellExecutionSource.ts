import * as vscode from "vscode";
import type { OutputWatcherDeps } from "./outputWatcher";
import type { LifecycleSubscriber } from "./shellIntegrationActivitySource";

type OnShellExecution = OutputWatcherDeps["onShellExecution"];

/**
 * Bind activity source `B` to the real VSCode shell-integration events.
 *
 * The critical difference from {@link createShellExecutionSource} below:
 * `execution.read()` is never called. We take only the lifecycle edges, so
 * no terminal bytes ever enter the extension host through this path.
 *
 * `commandLine` is read eagerly inside the event callback — the execution
 * object is only guaranteed valid for the lifetime of the event dispatch.
 */
export function createVscodeLifecycleSubscribers(): {
    onDidStart: LifecycleSubscriber;
    onDidEnd: LifecycleSubscriber;
} {
    return {
        onDidStart: (cb) => {
            const sub = vscode.window.onDidStartTerminalShellExecution(
                (event) => {
                    cb({
                        terminal: event.terminal,
                        commandLine: event.execution.commandLine?.value,
                    });
                }
            );
            return () => sub.dispose();
        },
        onDidEnd: (cb) => {
            const sub = vscode.window.onDidEndTerminalShellExecution(
                (event) => {
                    cb({
                        terminal: event.terminal,
                        commandLine: event.execution.commandLine?.value,
                        exitCode: event.exitCode,
                    });
                }
            );
            return () => sub.dispose();
        },
    };
}

/**
 * Adapter from VSCode's `onDidStartTerminalShellExecution` event to the
 * callback shape {@link OutputWatcher} consumes. Drains each execution's
 * async byte stream and forwards chunks, logging the lifecycle for the
 * diagnostic channel. Extracted from the feature root to keep the
 * shell-integration plumbing in one named place.
 */
export function createShellExecutionSource(
    log: (msg: string) => void
): OnShellExecution {
    return (cb) => {
        const disposable = vscode.window.onDidStartTerminalShellExecution(
            (event) => {
                log(
                    `shell-exec.start: terminal="${event.terminal.name}" ` +
                        `cmd="${event.execution.commandLine.value.slice(0, 60)}"`
                );
                cb({
                    terminal: event.terminal,
                    execution: {
                        onData: (dataCb) => {
                            log(
                                `shell-exec.onData wired for "${event.terminal.name}"`
                            );
                            void (async () => {
                                try {
                                    for await (const chunk of event.execution.read()) {
                                        dataCb(chunk);
                                        log(
                                            `shell-exec.chunk ${chunk.length}B ` +
                                                `for "${event.terminal.name}": ` +
                                                `data=${JSON.stringify(chunk)}`
                                        );
                                    }
                                    log(
                                        `shell-exec.stream closed for "${event.terminal.name}"`
                                    );
                                } catch (err) {
                                    log(
                                        `shell-exec.ERROR reading "${event.terminal.name}": ${err}`
                                    );
                                }
                            })();
                        },
                    },
                });
            }
        );
        return () => disposable.dispose();
    };
}
