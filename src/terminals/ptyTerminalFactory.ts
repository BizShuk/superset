import * as vscode from "vscode";
import * as nodePty from "@homebridge/node-pty-prebuilt-multiarch";
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
            kill: () => proc.kill(),
            resize: (cols, rows) => proc.resize(cols, rows),
        };
        return handle;
    };
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
    private readonly ptyBacked = new Set<vscode.Terminal>();

    constructor(private readonly deps: PtyTerminalFactoryDeps) {}

    /** True if this factory created `terminal`. */
    isPtyBacked(terminal: vscode.Terminal): boolean {
        return this.ptyBacked.has(terminal);
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
            env: process.env,
            log,
        });
        const pty = createPtyPseudoterminal(host);
        terminalRef = vscode.window.createTerminal({ name, pty });
        this.ptyBacked.add(terminalRef);
        log(`spawnPtyTerminal: "${name}" cwd=${cwd}`);
        return terminalRef;
    }
}
