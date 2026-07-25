import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as vscode from "vscode";
import { PtyTap, type Frame, type FrameSink } from "./ptyTap";

/**
 * Compute the per-window tap socket path. Mirrors the convention used by
 * `src/sessions/store.ts:35-52` (no shared helper exists yet).
 *
 * Path shape: `~/.config/superset/pty/<sessionId>-<pid>.sock`.
 * `sessionId` is the VS Code window id; `pid` is the extension host pid.
 * Together they uniquely identify one extension process even if multiple
 * windows are open.
 */
export function defaultTapSocketPath(sessionId: string, pid: number): string {
    return path.join(
        os.homedir(),
        ".config",
        "superset",
        "pty",
        `${sessionId}-${pid}.sock`
    );
}

/**
 * Unix domain socket server that broadcasts {@link Frame} JSON lines to
 * every connected client. Implements the {@link FrameSink} contract used
 * by {@link PtyTap}.
 *
 * Lifecycle:
 *   - `start()` removes any stale socket at the same path (the previous
 *     window may have crashed without unlinking) then begins listening.
 *   - `stop()` destroys live clients, closes the server, and unlinks the
 *     socket file so the next window starts clean.
 *   - Each socket write is fire-and-forget; if a slow client blocks,
 *     other clients are unaffected (Node streams buffer independently).
 */
export class PtyTapServer implements FrameSink {
    private readonly server: net.Server;
    private readonly clients = new Set<net.Socket>();

    private constructor(
        private readonly socketPath: string,
        private readonly log: (msg: string) => void
    ) {
        this.server = net.createServer((socket) => {
            this.clients.add(socket);
            this.log(
                `[ptyTap] client connected (total=${this.clients.size})`
            );
            const drop = (why: string) => {
                if (this.clients.delete(socket)) {
                    this.log(
                        `[ptyTap] client dropped (${why}) ` +
                            `(remaining=${this.clients.size})`
                    );
                }
            };
            socket.on("close", () => drop("close"));
            socket.on("error", (err) => drop(`error: ${err}`));
        });
    }

    static async create(
        socketPath: string,
        log: (msg: string) => void
    ): Promise<PtyTapServer> {
        const inst = new PtyTapServer(socketPath, log);
        await fs.promises.mkdir(path.dirname(socketPath), { recursive: true });
        try {
            await fs.promises.unlink(socketPath);
        } catch {
            // No stale socket — fine.
        }
        await new Promise<void>((resolve, reject) => {
            inst.server.once("error", reject);
            inst.server.listen(socketPath, () => {
                inst.server.off("error", reject);
                log(`[ptyTap] listening on ${socketPath}`);
                resolve();
            });
        });
        return inst;
    }

    /**
     * FrameSink implementation. Each frame is encoded as a single
     * newline-terminated JSON line and pushed to every live client.
     * Errors are logged but do not propagate — a failing client must
     * not stall other clients or the router.
     */
    write(frame: Frame): void {
        const line = `${JSON.stringify(frame)}\n`;
        for (const client of this.clients) {
            try {
                client.write(line);
            } catch (err) {
                this.log(`[ptyTap] client write ERROR: ${err}`);
            }
        }
    }

    async stop(): Promise<void> {
        for (const client of this.clients) {
            client.destroy();
        }
        this.clients.clear();
        await new Promise<void>((resolve) => this.server.close(() => resolve()));
        try {
            await fs.promises.unlink(this.socketPath);
        } catch {
            // Already gone.
        }
        this.log(`[ptyTap] stopped`);
    }
}

/**
 * Wire Shell Integration terminals into the tap. Subscribes to
 * `vscode.window.onDidStartTerminalShellExecution` and drains each
 * execution's async byte stream into the tap. Lifecycle envelope
 * (open / close) is emitted by the binding itself.
 *
 * `execution.read()` is consumed once per execution — this subscriber
 * competes with OutputWatcher's drain only if OutputWatcher's
 * `createShellExecutionSource` is also wired. OutputWatcher currently
 * uses its own drain (`src/terminals/index.ts:129-137`), so the two
 * are independent. Both can run side-by-side without conflict because
 * `onDidStartTerminalShellExecution` fires once per shell execution.
 *
 * Returns a disposer that stops new subscriptions and is safe to call
 * multiple times.
 */
export function subscribeShellExecToTap(
    tap: PtyTap,
    log: (msg: string) => void
): () => void {
    const disposable = vscode.window.onDidStartTerminalShellExecution(
        (event) => {
            const binding = tap.bindShellExec(event.terminal.name);
            log(
                `[ptyTap] shell-exec open id=${binding.id} ` +
                    `name="${event.terminal.name}" ` +
                    `cmd="${event.execution.commandLine.value.slice(0, 60)}"`
            );
            void (async () => {
                try {
                    for await (const chunk of event.execution.read()) {
                        binding.onData(chunk);
                    }
                    binding.onClose(null);
                } catch (err) {
                    log(
                        `[ptyTap] shell-exec ERROR name="${event.terminal.name}"` +
                            `: ${err}`
                    );
                    binding.onClose(-1);
                }
            })();
        }
    );
    let disposed = false;
    return () => {
        if (disposed) {
            return;
        }
        disposed = true;
        disposable.dispose();
    };
}
