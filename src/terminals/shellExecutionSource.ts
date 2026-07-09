import * as vscode from "vscode";
import type { OutputWatcherDeps } from "./outputWatcher";
import type { TerminalHandle } from "./types";

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

/** Subscriber signature for raw shell-integration chunks. */
export type ShellExecutionChunkListener = (
    terminal: TerminalHandle,
    chunk: string
) => void;

/**
 * Independent fan-out over the same shell-integration stream consumed
 * by {@link createShellExecutionSource}. OutputWatcher already drains
 * `execution.read()` for *its* purposes (mark-unseen on data events),
 * but it deliberately ignores the chunk payload — for the mermaid
 * buffer we need the actual bytes. `execution.read()` can only be
 * consumed once per execution, so the fan-out must attach to the
 * event source **before** OutputWatcher and re-broadcast the data
 * to additional subscribers. Each subscriber is isolated with its
 * own try/catch so a faulty listener doesn't poison the rest.
 */
export interface ShellExecutionChunkFanOut {
    subscribe(cb: ShellExecutionChunkListener): () => void;
    dispose(): void;
}

export function createShellExecutionChunkFanOut(
    log: (msg: string) => void
): ShellExecutionChunkFanOut {
    const listeners = new Set<ShellExecutionChunkListener>();
    const disposable = vscode.window.onDidStartTerminalShellExecution(
        (event) => {
            log(
                `shell-fanout.start: terminal="${event.terminal.name}" ` +
                    `cmd="${event.execution.commandLine.value.slice(0, 60)}"`
            );
            void (async () => {
                try {
                    for await (const chunk of event.execution.read()) {
                        for (const cb of listeners) {
                            try {
                                cb(event.terminal, chunk);
                            } catch (err) {
                                log(
                                    `shell-fanout.listener ERROR: ${err}`
                                );
                            }
                        }
                    }
                    log(
                        `shell-fanout.stream closed for "${event.terminal.name}"`
                    );
                } catch (err) {
                    log(
                        `shell-fanout.ERROR reading "${event.terminal.name}": ${err}`
                    );
                }
            })();
        }
    );
    return {
        subscribe(cb) {
            listeners.add(cb);
            return () => {
                listeners.delete(cb);
            };
        },
        dispose() {
            listeners.clear();
            disposable.dispose();
        },
    };
}
