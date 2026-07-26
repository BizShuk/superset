import * as vscode from "vscode";
import * as nodePty from "node-pty";
import type { TerminalHandle } from "./types";
import { TerminalRegistry } from "./terminalRegistry";
import {
    PtyTerminalHost,
    type PtyProcess,
    type PtySpawner,
} from "./ptyTerminalHost";

/** Concrete `node-pty` binding behind the {@link PtySpawner} interface. */
export function createNodePtySpawner(): PtySpawner {
    return (file, args, options) => {
        const proc = nodePty.spawn(file, args, {
            cwd: options.cwd,
            env: options.env as Record<string, string>,
            cols: options.cols,
            rows: options.rows,
        });
        const handle: PtyProcess = {
            onData: (cb) => proc.onData(cb),
            onExit: (cb) => proc.onExit(({ exitCode }) => cb(exitCode ?? 0)),
            write: (data) => proc.write(data),
            kill: (signal) => proc.kill(signal),
            resize: (cols, rows) => proc.resize(cols, rows),
            pause: () => proc.pause(),
            resume: () => proc.resume(),
        };
        return handle;
    };
}

/**
 * Environment variables that must not reach a user shell.
 *
 * The extension host runs under Electron with `ELECTRON_RUN_AS_NODE` set and a
 * pile of `VSCODE_*` handshake variables. Passing `process.env` through
 * verbatim leaks all of it into the child shell, where it breaks any
 * `node`-based tool the user runs (Electron's node treats the flag as a mode
 * switch) and confuses anything that sniffs `VSCODE_*` to detect an integrated
 * terminal.
 */
const STRIPPED_ENV_PREFIXES = ["VSCODE_", "ELECTRON_"];
const STRIPPED_ENV_KEYS = new Set([
    "ELECTRON_RUN_AS_NODE",
    "NODE_OPTIONS",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
]);

/**
 * Build the child shell's environment.
 *
 * `TERM` is set explicitly because the extension host frequently has none, and
 * a TUI that cannot identify the terminal either renders garbage or blocks
 * waiting for a capability response that never comes.
 */
export function buildShellEnv(
    source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(source)) {
        if (STRIPPED_ENV_KEYS.has(key)) {
            continue;
        }
        if (STRIPPED_ENV_PREFIXES.some((p) => key.startsWith(p))) {
            continue;
        }
        env[key] = value;
    }
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    env.TERM_PROGRAM = "vscode";
    return env;
}

/** Adapt a {@link PtyTerminalHost} to VSCode's stable `Pseudoterminal` API. */
function createPtyPseudoterminal(host: PtyTerminalHost): vscode.Pseudoterminal {
    return {
        onDidWrite: (listener) => ({
            dispose: host.onWrite((data) => listener(data)),
        }),
        onDidClose: (listener) => ({
            dispose: host.onClose((code) => listener(code)),
        }),
        open: (initialDimensions) => {
            host.open({
                columns: initialDimensions?.columns ?? 80,
                rows: initialDimensions?.rows ?? 24,
            });
        },
        close: () => host.close(),
        handleInput: (data) => host.handleInput(data),
        setDimensions: (dimensions) =>
            host.setDimensions({
                columns: dimensions.columns,
                rows: dimensions.rows,
            }),
    };
}

export interface PtyTerminalFactoryDeps {
    readonly registry: TerminalRegistry;
    readonly getWatched: () => vscode.Terminal | undefined;
    readonly isRecentlyActive: (terminal: TerminalHandle) => boolean;
    readonly spawn: PtySpawner;
    readonly log: (msg: string) => void;
}

/**
 * Creates PTY-backed terminals — the mechanism that lets the extension hold
 * the master PTY and so intercept 100% of TUI output. Owns the set of
 * terminals it created so the open-terminal lifecycle can tell them apart
 * from user/agent terminals (and avoid the auto-replace infinite loop).
 */
export class PtyTerminalFactory {
    /**
     * Terminals this factory created, mapped to their host.
     *
     * A plain `Set` here previously never shed entries: every terminal ever
     * spawned stayed strongly referenced for the life of the window, and
     * `isPtyBacked` kept answering true for disposed ones. The map is pruned
     * by {@link forget} and drained by {@link dispose}.
     */
    private readonly hosts = new Map<vscode.Terminal, PtyTerminalHost>();

    constructor(private readonly deps: PtyTerminalFactoryDeps) {}

    /** True if this factory created `terminal`. */
    isPtyBacked(terminal: vscode.Terminal): boolean {
        return this.hosts.has(terminal);
    }

    /** Drop a closed terminal. Called from the `onDidCloseTerminal` bridge. */
    forget(terminal: vscode.Terminal): void {
        this.hosts.delete(terminal);
    }

    /**
     * Close every PTY this factory still owns.
     *
     * Without this, deactivating the extension left the shells running: VS
     * Code disposes its own terminals on reload, but nothing tore down the
     * hosts on an extension-only teardown, so each activation cycle stacked
     * another generation of orphaned shells.
     */
    dispose(): void {
        for (const host of this.hosts.values()) {
            try {
                host.close();
            } catch (err) {
                this.deps.log(`ptyFactory.dispose: host close error: ${err}`);
            }
        }
        this.hosts.clear();
    }

    /** Spawn a PTY-backed terminal named `name` rooted at `cwd`. */
    spawn(name: string, cwd: string): vscode.Terminal {
        const { registry, getWatched, isRecentlyActive, spawn, log } =
            this.deps;
        let terminalRef: vscode.Terminal | undefined;
        const host = new PtyTerminalHost({
            getTerminal: () => terminalRef,
            registry,
            getActiveTerminal: getWatched,
            isRecentlyActive,
            spawn,
            shell: process.env.SHELL || "/bin/bash",
            args: ["-i"],
            cwd,
            env: buildShellEnv(),
            getConfig: readWaterMarkConfig,
            log,
            onSpawnError: (message) => {
                void vscode.window.showErrorMessage(
                    `Superset: 無法啟動 PTY terminal：${message}`
                );
            },
        });
        const pty = createPtyPseudoterminal(host);
        terminalRef = vscode.window.createTerminal({ name, pty });
        this.hosts.set(terminalRef, host);
        log(`spawnPtyTerminal: "${name}" cwd=${cwd}`);
        return terminalRef;
    }
}

/** Watermarks from VS Code settings, expressed in MiB by the user. */
function readWaterMarkConfig(): {
    highWaterMark?: number;
    lowWaterMark?: number;
} {
    const cfg = vscode.workspace.getConfiguration("superset.terminals");
    const toBytes = (value: number | undefined): number | undefined =>
        typeof value === "number" ? value * 1024 * 1024 : undefined;
    return {
        highWaterMark: toBytes(cfg.get<number>("highWaterMark")),
        lowWaterMark: toBytes(cfg.get<number>("lowWaterMark")),
    };
}
