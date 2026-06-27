import * as vscode from "vscode";
import type { OutputWatcherDeps } from "./outputWatcher";

type OnShellExecution = OutputWatcherDeps["onShellExecution"];

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
