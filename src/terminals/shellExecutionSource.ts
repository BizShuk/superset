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
 * Command text is deliberately not copied into activity events or diagnostics.
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
                log("shell-exec.start");
                cb({
                    terminal: event.terminal,
                    execution: {
                        onData: (dataCb) => {
                            log("shell-exec.onData wired");
                            void (async () => {
                                try {
                                    for await (const chunk of event.execution.read()) {
                                        dataCb(chunk);
                                        log(
                                            `shell-exec.chunk ${Buffer.byteLength(
                                                chunk,
                                                "utf8"
                                            )}B`
                                        );
                                    }
                                    log("shell-exec.stream closed");
                                } catch {
                                    log("shell-exec.ERROR reading stream");
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
