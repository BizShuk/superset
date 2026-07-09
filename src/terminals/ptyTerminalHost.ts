import type { TerminalHandle } from "./types";
import type { TerminalRegistry } from "./terminalRegistry";

/**
 * Minimal PTY-process contract. Mirrors the surface of `@homebridge/node-pty-prebuilt-multiarch`
 * that we actually use, so tests can fake it without pulling in the
 * native module.
 */
export interface PtyProcess {
    onData(cb: (data: string) => void): void;
    onExit(cb: (code: number) => void): void;
    write(data: string): void;
    kill(): void;
    resize?(cols: number, rows: number): void;
}

export interface PtySpawnOptions {
    cwd: string;
    env: NodeJS.ProcessEnv;
    cols: number;
    rows: number;
}

export type PtySpawner = (
    file: string,
    args: string[],
    options: PtySpawnOptions
) => PtyProcess;

export interface PtyTerminalHostDeps {
    /**
     * Resolves to the `vscode.Terminal` this host is bound to. Deferred
     * because the host must be constructed BEFORE the terminal (it
     * provides the `Pseudoterminal` to `createTerminal`), but the
     * terminal reference isn't available until after that call.
     * The closure indirection lets the host read the terminal later.
     */
    getTerminal: () => TerminalHandle | undefined;
    registry: TerminalRegistry;
    getActiveTerminal: () => TerminalHandle | undefined;
    /**
     * PTY factory. Injected so tests can fake it; production wires this
     * to `@homebridge/node-pty-prebuilt-multiarch`'s `spawn`.
     */
    spawn: PtySpawner;
    /** Shell executable to run inside the PTY (e.g. `/bin/zsh`). */
    shell: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    isRecentlyActive?: (terminal: TerminalHandle) => boolean;
    log?: (msg: string) => void;
    /**
     * Optional command to run inside the shell once it spawns.
     * Used by the mDNS one-click-connect flow (`Superset: Connect`)
     * to write `ssh pi@nas.local` into the freshly-opened PTY
     * without forcing the user to type it. Defer one tick so the
     * shell prompt has time to settle before we type.
     */
    initialCommand?: string;
}

/**
 * Hosts a real PTY-backed terminal (via `vscode.Pseudoterminal`) so the
 * extension sees every byte the user's shell produces — including TUI
 * redraws that shell-integration-based `execution.read()` silently drops
 * for `claude`, `vim`, `htop`, etc.
 *
 * Lifecycle: the assembly layer (`extension.ts`) wraps an instance of
 * this class in a `vscode.Pseudoterminal` and passes it to
 * `vscode.window.createTerminal({ pty })`. The framework calls `open`
 * when the terminal is shown and `close` when it's disposed.
 *
 * TUI detection: any data received from the PTY while this terminal is
 * not the active one triggers `registry.markUnseen`. The registry is
 * idempotent so duplicate triggers (e.g. during a fast TUI redraw)
 * collapse to a single highlight.
 */
export class PtyTerminalHost {
    private proc?: PtyProcess;
    private writeListeners = new Set<(data: string) => void>();
    private closeListeners = new Set<(code: number | void) => void>();
    private opened = false;
    /** Track which terminals we have already logged markUnseen for, so the
     *  diagnostic channel is not flooded during high-rate TUI redraws. */
    private unseenLogged = new WeakSet<import("./types").TerminalHandle>();

    constructor(private readonly deps: PtyTerminalHostDeps) {}

    /**
     * Called by `vscode.Pseudoterminal.open()`. Spawns the shell inside
     * a real PTY and wires output / input / resize plumbing.
     */
    open(dimensions: { columns: number; rows: number }): void {
        if (this.opened) {
            return;
        }
        this.opened = true;
        const log = this.deps.log;
        log?.(
            `[pty] open shell="${this.deps.shell}" cwd="${this.deps.cwd}" ` +
                `cols=${dimensions.columns} rows=${dimensions.rows}`
        );
        this.proc = this.deps.spawn(this.deps.shell, this.deps.args, {
            cwd: this.deps.cwd,
            env: this.deps.env,
            cols: dimensions.columns,
            rows: dimensions.rows,
        });

        this.proc.onData((data) => {
            this.fireWrite(data);
            this.detectActivity(data);
        });

        this.proc.onExit((code) => {
            log?.(`[pty] exit code=${code}`);
            this.fireClose(code);
        });

        if (this.deps.initialCommand) {
            // Defer one tick: the shell may not be ready to accept
            // input the instant the PTY is spawned. 50ms is empirical
            // — long enough to clear the prompt echo, short enough
            // to feel instant in the UI.
            const cmd = this.deps.initialCommand;
            setTimeout(() => {
                try {
                    this.proc?.write(`${cmd}\n`);
                } catch (err) {
                    log?.(`[pty] initialCommand write error: ${err}`);
                }
            }, 50);
        }
    }

    /**
     * Called by `vscode.Pseudoterminal.close()`. Kills the underlying
     * process; subsequent `handleInput` / `setDimensions` calls become
     * no-ops.
     */
    close(): void {
        if (!this.opened) {
            return;
        }
        this.opened = false;
        this.deps.log?.(`[pty] close`);
        try {
            this.proc?.kill();
        } catch (err) {
            this.deps.log?.(`[pty] kill error: ${err}`);
        }
        this.proc = undefined;
        this.fireClose();
    }

    /** Called by `vscode.Pseudoterminal.handleInput()`. */
    handleInput(data: string): void {
        if (!this.proc) {
            return;
        }
        try {
            this.proc.write(data);
        } catch (err) {
            this.deps.log?.(`[pty] write error: ${err}`);
        }
    }

    /** Called by `vscode.Pseudoterminal.setDimensions()`. */
    setDimensions(dimensions: { columns: number; rows: number }): void {
        if (!this.proc?.resize) {
            return;
        }
        try {
            this.proc.resize(dimensions.columns, dimensions.rows);
        } catch (err) {
            // Resize can race with process exit; ignore.
            this.deps.log?.(`[pty] resize error: ${err}`);
        }
    }

    /**
     * Subscribe to data writes coming from the PTY. Returns a disposer.
     * The assembly layer wraps this in `vscode.Pseudoterminal.onDidWrite`.
     */
    onWrite(cb: (data: string) => void): () => void {
        this.writeListeners.add(cb);
        return () => {
            this.writeListeners.delete(cb);
        };
    }

    /**
     * Subscribe to PTY close events. Wraps `vscode.Pseudoterminal.onDidClose`.
     */
    onClose(cb: (code: number | void) => void): () => void {
        this.closeListeners.add(cb);
        return () => {
            this.closeListeners.delete(cb);
        };
    }

    private fireWrite(data: string): void {
        for (const cb of this.writeListeners) {
            cb(data);
        }
    }

    private fireClose(code: number | void = undefined): void {
        for (const cb of this.closeListeners) {
            cb(code);
        }
    }

    private detectActivity(data: string): void {
        const terminal = this.deps.getTerminal();
        if (!terminal) {
            // Terminal ref not yet bound (race during createTerminal).
            return;
        }
        const active = this.deps.getActiveTerminal();
        if (active === terminal) {
            return;
        }
        if (this.deps.isRecentlyActive?.(terminal)) {
            return;
        }
        // Only log diagnostic on first unseen flip; markUnseen is idempotent
        // so subsequent chunks from the same terminal are no-ops.
        if (!this.unseenLogged.has(terminal)) {
            this.deps.log?.(
                `[pty] markUnseen("${terminal.name}") ` +
                    `bytes=${data.length} active="${active?.name ?? "<none>"}"`
            );
            this.unseenLogged.add(terminal);
        }
        this.deps.registry.markUnseen(terminal);
    }
}