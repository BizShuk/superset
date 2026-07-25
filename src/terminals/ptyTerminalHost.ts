import type { TerminalHandle } from "./types";
import type { TerminalRegistry } from "./terminalRegistry";

/**
 * Minimal PTY-process contract. Mirrors the surface of `node-pty`'s `IPty`
 * that we actually use, so tests can fake it without pulling in the
 * native module.
 */
export interface PtyProcess {
    onData(cb: (data: string) => void): void;
    onExit(cb: (code: number) => void): void;
    write(data: string): void;
    /**
     * `signal` is optional so existing fakes stay valid. Production passes an
     * explicit signal to escalate a shell that ignores the default `SIGHUP`.
     */
    kill(signal?: string): void;
    resize?(cols: number, rows: number): void;
    /**
     * Stop / restart the underlying socket. Optional because the test fakes
     * predate them; when absent, backpressure bookkeeping still runs but has
     * nothing to act on.
     */
    pause?(): void;
    resume?(): void;
}

/** Watermarks, in bytes. See {@link PtyTerminalHostDeps.getConfig}. */
export const DEFAULT_HIGH_WATER_MARK = 4 * 1024 * 1024;
export const DEFAULT_LOW_WATER_MARK = 1 * 1024 * 1024;
export const MIN_WATER_MARK = 1024 * 1024;
export const MAX_WATER_MARK = 64 * 1024 * 1024;

/**
 * Upper bound on how many bytes one flush hands to `onDidWrite`.
 *
 * `vscode.Pseudoterminal.onDidWrite` serialises its payload across the
 * extension-host RPC boundary with no acknowledgement from the renderer, so a
 * single 500 MiB emit would block the host for as long as that serialisation
 * takes. Capping the per-tick payload turns one unbounded stall into a series
 * of bounded ones, and is what lets `pendingBytes` fall back below the low
 * watermark gradually rather than all at once.
 *
 * 1 MiB is far above any realistic single PTY read (64 KiB), so ordinary
 * output still coalesces into exactly one emit per tick.
 */
export const MAX_FLUSH_BYTES = 1024 * 1024;

/** Grace period between the polite kill and `SIGKILL`. */
export const KILL_ESCALATION_MS = 2000;

export interface WaterMarkConfig {
    readonly highWaterMark: number;
    readonly lowWaterMark: number;
}

/**
 * Clamp a watermark pair into a usable range.
 *
 * Exported for the factory, which reads raw numbers out of VS Code settings
 * where a user can type anything. An inverted or degenerate pair would either
 * pause and never resume, or thrash pause/resume on every chunk.
 */
export function normalizeWaterMarks(
    config: Partial<WaterMarkConfig> | undefined
): WaterMarkConfig {
    const clamp = (value: number | undefined, fallback: number): number => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return fallback;
        }
        return Math.min(MAX_WATER_MARK, Math.max(MIN_WATER_MARK, value));
    };
    const high = clamp(config?.highWaterMark, DEFAULT_HIGH_WATER_MARK);
    let low = clamp(config?.lowWaterMark, DEFAULT_LOW_WATER_MARK);
    if (low >= high) {
        // A low mark at or above the high mark can never be reached from
        // above, so the pty would stay paused forever. Fall back to half.
        low = Math.max(MIN_WATER_MARK, Math.floor(high / 2));
    }
    return { highWaterMark: high, lowWaterMark: low };
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
     * to upstream `node-pty`'s `spawn`.
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
    /**
     * Watermark source. Read once per `open()` so a settings change applies to
     * newly opened terminals without disturbing running ones. Absent in tests,
     * which fall back to the defaults.
     */
    getConfig?: () => Partial<WaterMarkConfig>;
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
    /**
     * Coalescing buffer: chunks from the native PTY are joined and flushed
     * at the next `setImmediate` boundary so multiple chunks per event-loop
     * turn become a single `vscode.Pseudoterminal.onDidWrite` emit. The
     * 4ms-typical latency is humanly imperceptible and materially reduces
     * IPC overhead under high-rate output (e.g. `cat large-file`, `find /`).
     * `detectActivity` still runs per-chunk upstream so markUnseen timing
     * is unaffected.
     */
    private writeBuffer = "";
    private pendingFlush: NodeJS.Immediate | null = null;
    /**
     * Bytes received from the PTY that we have not yet handed to
     * `onDidWrite` — i.e. the depth of the queue this class owns. This is the
     * only queue in the pipeline we can actually measure: everything past
     * `fireWrite` lives inside VS Code, and `Pseudoterminal.onDidWrite` is
     * fire-and-forget with no acknowledgement from the renderer.
     */
    private pendingBytes = 0;
    private paused = false;
    private waterMarks: WaterMarkConfig = normalizeWaterMarks(undefined);
    /**
     * Set once the process is gone (exited or killed). Distinct from
     * `opened === false`, which only means "not currently open" and would let
     * a stray `open()` silently respawn a shell the user believes is dead.
     */
    private disposed = false;
    /** Guards against `onDidClose` firing twice for one process. */
    private closeFired = false;
    private killTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly deps: PtyTerminalHostDeps) {}

    /**
     * Called by `vscode.Pseudoterminal.open()`. Spawns the shell inside
     * a real PTY and wires output / input / resize plumbing.
     */
    open(dimensions: { columns: number; rows: number }): void {
        if (this.opened || this.disposed) {
            return;
        }
        this.opened = true;
        this.waterMarks = normalizeWaterMarks(this.deps.getConfig?.());
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
            this.bufferWrite(data);
            this.detectActivity(data);
        });

        this.proc.onExit((code) => {
            log?.(`[pty] exit code=${code}`);
            // Tear down for real. Leaving `proc` set meant every later
            // `handleInput` wrote into a dead pty and had the error swallowed
            // by its try/catch — the user typed and nothing happened, with no
            // indication the terminal was gone.
            this.flushWriteBuffer();
            this.opened = false;
            this.disposed = true;
            this.proc = undefined;
            this.clearKillTimer();
            this.pendingBytes = 0;
            this.paused = false;
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
        this.disposed = true;
        this.deps.log?.(`[pty] close`);
        this.flushWriteBuffer();
        const proc = this.proc;
        // Pair any outstanding pause with a resume before killing. A paused
        // socket cannot drain, so a shell killed while paused can block on its
        // own write and never reach the signal handler.
        if (this.paused) {
            this.paused = false;
            this.deps.log?.(`[pty] backpressure RESUME (close)`);
            try {
                proc?.resume?.();
            } catch (err) {
                this.deps.log?.(`[pty] resume error: ${err}`);
            }
        }
        this.pendingBytes = 0;
        try {
            proc?.kill();
        } catch (err) {
            this.deps.log?.(`[pty] kill error: ${err}`);
        }
        // Escalate. The default signal is SIGHUP, which a foreground process
        // can ignore (a wedged `ssh`, a `docker exec`); without escalation
        // those shells outlive the window and leak their pty fds, and enough
        // of them eventually make new terminals fail to spawn.
        this.clearKillTimer();
        this.killTimer = setTimeout(() => {
            this.killTimer = null;
            try {
                proc?.kill("SIGKILL");
                this.deps.log?.(`[pty] escalated to SIGKILL`);
            } catch {
                // Already reaped — the normal path.
            }
        }, KILL_ESCALATION_MS);
        (this.killTimer as { unref?: () => void }).unref?.();
        this.proc = undefined;
        this.fireClose();
    }

    private clearKillTimer(): void {
        if (this.killTimer !== null) {
            clearTimeout(this.killTimer);
            this.killTimer = null;
        }
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
            try {
                cb(data);
            } catch (err) {
                this.deps.log?.(`[pty] write listener ERROR: ${err}`);
            }
        }
    }

    /**
     * Coalesce a chunk into the write buffer and schedule a flush on the
     * next event-loop turn. Multiple chunks arriving in the same tick
     * collapse into a single `fireWrite` call.
     */
    private bufferWrite(data: string): void {
        this.writeBuffer += data;
        this.pendingBytes += Buffer.byteLength(data);
        this.applyBackpressure();
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.pendingFlush !== null) {
            return;
        }
        this.pendingFlush = setImmediate(() => {
            this.pendingFlush = null;
            this.drainOnce();
        });
    }

    /**
     * Emit at most {@link MAX_FLUSH_BYTES} and reschedule while data remains.
     *
     * Splitting on a byte budget means a burst that arrived in one tick is
     * handed to the renderer over several, which is what allows `pendingBytes`
     * to cross back below the low watermark and release the pause.
     */
    private drainOnce(): void {
        if (this.writeBuffer.length === 0) {
            this.releaseBackpressure();
            return;
        }
        let out: string;
        if (Buffer.byteLength(this.writeBuffer) <= MAX_FLUSH_BYTES) {
            out = this.writeBuffer;
            this.writeBuffer = "";
        } else {
            // Slice by code units, not bytes: cutting mid-surrogate would
            // hand the renderer a lone surrogate and corrupt the character.
            // The byte budget is a target, not a hard cap, and multi-byte
            // characters only ever make the slice smaller than requested.
            out = this.writeBuffer.slice(0, MAX_FLUSH_BYTES);
            const tail = this.writeBuffer.charCodeAt(MAX_FLUSH_BYTES - 1);
            if (tail >= 0xd800 && tail <= 0xdbff) {
                out = out.slice(0, -1);
            }
            this.writeBuffer = this.writeBuffer.slice(out.length);
        }
        this.pendingBytes = Math.max(
            0,
            this.pendingBytes - Buffer.byteLength(out)
        );
        this.fireWrite(out);
        this.releaseBackpressure();
        if (this.writeBuffer.length > 0) {
            this.scheduleFlush();
        }
    }

    /** Stop the pty once our own queue exceeds the high watermark. */
    private applyBackpressure(): void {
        if (this.paused || this.pendingBytes < this.waterMarks.highWaterMark) {
            return;
        }
        this.paused = true;
        this.deps.log?.(
            `[pty] backpressure PAUSE pendingBytes=${this.pendingBytes}`
        );
        try {
            this.proc?.pause?.();
        } catch (err) {
            this.deps.log?.(`[pty] pause error: ${err}`);
        }
    }

    /** Restart the pty once the queue has drained below the low watermark. */
    private releaseBackpressure(): void {
        if (!this.paused || this.pendingBytes > this.waterMarks.lowWaterMark) {
            return;
        }
        this.paused = false;
        this.deps.log?.(
            `[pty] backpressure RESUME pendingBytes=${this.pendingBytes}`
        );
        try {
            this.proc?.resume?.();
        } catch (err) {
            this.deps.log?.(`[pty] resume error: ${err}`);
        }
    }

    /**
     * Flush any pending coalesced data immediately. Called from `close()`
     * and from the `proc.onExit` path so the consumer never loses the
     * tail bytes that would otherwise be delivered after the proc died.
     */
    private flushWriteBuffer(): void {
        if (this.pendingFlush !== null) {
            clearImmediate(this.pendingFlush);
            this.pendingFlush = null;
        }
        if (this.writeBuffer.length > 0) {
            const out = this.writeBuffer;
            this.writeBuffer = "";
            this.pendingBytes = 0;
            // The byte budget deliberately does not apply here: this is the
            // final flush before teardown, and withholding the tail would
            // lose it outright rather than merely delay it.
            this.fireWrite(out);
        }
    }

    private fireClose(code: number | void = undefined): void {
        if (this.closeFired) {
            return;
        }
        this.closeFired = true;
        for (const cb of this.closeListeners) {
            try {
                cb(code);
            } catch (err) {
                this.deps.log?.(`[pty] close listener ERROR: ${err}`);
            }
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