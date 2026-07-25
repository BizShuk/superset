/**
 * PtyTap — pure (no `vscode` import) in-memory router that frames terminal
 * events as NDJSON and dispatches them to a {@link FrameSink}. Two source
 * paths are supported:
 *
 *   1. PTY-backed terminals (Superset-owned via `PtyTerminalFactory`)
 *      — caller binds `host.onWrite` and `host.onClose` to the adapter
 *      functions returned by {@link PtyTap.bindPty}.
 *
 *   2. Non-PTY Shell Integration terminals — caller drives the adapter
 *      functions from its own `for await (const chunk of execution.read())`
 *      drain loop and uses `bindShellExec` to obtain start/end envelope.
 *
 * The router owns the integer id space, the `(id → entry)` map, and emits
 * a single `meta` frame on first dispatch so consumers learn the session
 * identity without needing a separate handshake.
 *
 * Sink isolation: each sink write is wrapped in try/catch and routed
 * through an optional `log` callback so a faulty sink cannot poison
 * subsequent frames. The router itself never throws.
 */

export type TapKind = "pty" | "shell-exec";

export interface TapEntry {
    readonly id: number;
    readonly name: string;
    readonly kind: TapKind;
    readonly cwd?: string;
    readonly openTs: number;
}

export type Frame =
    | {
          t: "meta";
          v: 1;
          sessionId: string;
          pid: number;
          ts: number;
      }
    | {
          t: "open";
          id: number;
          name: string;
          cwd?: string;
          kind: TapKind;
          ts: number;
      }
    | { t: "data"; id: number; chunk: string; ts: number }
    | { t: "close"; id: number; code: number | null; ts: number };

export interface FrameSink {
    write(frame: Frame): void;
}

/**
 * Adapter returned from {@link PtyTap.bindPty} / {@link PtyTap.bindShellExec}.
 * The caller drives the three callbacks; the tap handles framing, ordering,
 * and idempotency.
 */
export interface TapBinding {
    readonly id: number;
    /** Forward a chunk from the underlying source. */
    onData(chunk: string): void;
    /** Mark the source as closed. Idempotent — subsequent calls are no-ops. */
    onClose(code: number | null): void;
}

export interface PtyTapOptions {
    sessionId: string;
    pid: number;
    sink: FrameSink;
    log?: (msg: string) => void;
    /** Override `Date.now()` for deterministic tests. */
    now?: () => number;
}

export class PtyTap {
    private nextId = 1;
    private readonly entries = new Map<number, TapEntry>();
    private metaSent = false;
    private readonly now: () => number;

    constructor(private readonly opts: PtyTapOptions) {
        this.now = opts.now ?? (() => Date.now());
    }

    /** Number of currently-open entries (open but not yet closed). */
    size(): number {
        return this.entries.size;
    }

    /** Read-only snapshot of open entries. */
    openEntries(): ReadonlyMap<number, TapEntry> {
        return new Map(this.entries);
    }

    /** Bind a PTY-backed terminal. The returned adapter is the bridge from
     *  `PtyTerminalHost.onWrite` / `onClose` into the tap. */
    bindPty(name: string, cwd?: string): TapBinding {
        return this.bind(name, cwd, "pty");
    }

    /** Bind a Shell Integration terminal. The caller drives `onData` from
     *  its own `execution.read()` drain and `onClose` after the drain ends. */
    bindShellExec(name: string): TapBinding {
        return this.bind(name, undefined, "shell-exec");
    }

    private bind(
        name: string,
        cwd: string | undefined,
        kind: TapKind
    ): TapBinding {
        const id = this.nextId++;
        const entry: TapEntry = {
            id,
            name,
            kind,
            cwd,
            openTs: this.now(),
        };
        this.entries.set(id, entry);
        this.dispatch({
            t: "open",
            id,
            name,
            cwd,
            kind,
            ts: entry.openTs,
        });
        let closed = false;
        const self = this;
        return {
            id,
            onData(chunk: string): void {
                if (closed) {
                    return;
                }
                self.dispatch({
                    t: "data",
                    id,
                    chunk,
                    ts: self.now(),
                });
            },
            onClose(code: number | null): void {
                if (closed) {
                    return;
                }
                closed = true;
                self.entries.delete(id);
                self.dispatch({ t: "close", id, code, ts: self.now() });
            },
        };
    }

    private dispatch(frame: Frame): void {
        if (!this.metaSent) {
            this.metaSent = true;
            this.safeEmit({
                t: "meta",
                v: 1,
                sessionId: this.opts.sessionId,
                pid: this.opts.pid,
                ts: this.now(),
            });
        }
        this.safeEmit(frame);
    }

    private safeEmit(frame: Frame): void {
        try {
            this.opts.sink.write(frame);
        } catch (err) {
            this.opts.log?.(`[ptyTap] sink write ERROR: ${err}`);
        }
    }
}
