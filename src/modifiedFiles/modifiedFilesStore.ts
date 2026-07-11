import * as vscode from "vscode";
import * as gitStatusParser from "./gitStatusParser";
import * as treeBuilder from "./treeBuilder";
import type { ModifiedFile, TreeNode } from "./types";

const SCAN_TIMEOUT_MS = 10_000;

export type ModifiedFilesState =
    | { readonly kind: "loading" }
    | {
          readonly kind: "ready";
          readonly nodes: readonly TreeNode[];
          readonly files: readonly ModifiedFile[];
          readonly refreshedAt: number;
      }
    | { readonly kind: "error"; readonly message: string };

export interface SpawnResult {
    readonly stdout: string;
    readonly stderr: string;
}

export interface ModifiedFilesStoreOptions {
    readonly workspaceRoot: string;
    readonly debounceMs: number;
    /**
     * Spawns a child process. Must resolve with stdout/stderr.
     * Injected for testing; production passes `spawnExecFile` from index.ts.
     */
    readonly spawn: (cmd: string, args: readonly string[]) => Promise<SpawnResult>;
    /** Injectable clock for testing; production passes `() => Date.now()`. */
    readonly clock: () => number;
}

export type ModifiedFilesListener = (state: ModifiedFilesState) => void;

export class ModifiedFilesStore {
    private state: ModifiedFilesState = { kind: "loading" };
    private showUntracked = true; // default ON per user decision
    private readonly listeners = new Set<ModifiedFilesListener>();
    private debounceTimer: NodeJS.Timeout | undefined;
    private watcher: vscode.FileSystemWatcher | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly options: ModifiedFilesStoreOptions) {}

    /**
     * Initial population + start watching for changes. Resolves when first
     * scan completes (success or error). Errors do NOT throw — they transition
     * to `state.kind === "error"` and emit.
     */
    async start(): Promise<void> {
        await this.refresh();
        const watcher = vscode.workspace.createFileSystemWatcher("**/*");
        const onFsEvent = () => this.scheduleRefresh();
        this.disposables.push(
            watcher.onDidChange(onFsEvent),
            watcher.onDidCreate(onFsEvent),
            watcher.onDidDelete(onFsEvent),
            watcher,
        );
        this.watcher = watcher;
    }

    /**
     * Run `git status --porcelain` (with 10s timeout), parse, build tree.
     * Idempotent — safe to call multiple times. Failures land in error state.
     */
    async refresh(): Promise<void> {
        try {
            const stdout = await Promise.race([
                this.options.spawn("git", ["status", "--porcelain"]).then(r => r.stdout),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error(`git status timed out after ${SCAN_TIMEOUT_MS}ms`)),
                        SCAN_TIMEOUT_MS,
                    ),
                ),
            ]);
            const files = gitStatusParser.parse(stdout);
            const nodes = treeBuilder.build(files, { showUntracked: this.showUntracked });
            this.state = { kind: "ready", nodes, files, refreshedAt: this.options.clock() };
        } catch (err) {
            this.state = {
                kind: "error",
                message: err instanceof Error ? err.message : String(err),
            };
        }
        this.emit();
    }

    /**
     * Toggle `?` files visibility. Does NOT re-spawn git status — the parsed
     * `state.files` already contains them; just rebuilds the tree.
     */
    toggleUntracked(): void {
        this.showUntracked = !this.showUntracked;
        if (this.state.kind === "ready") {
            const nodes = treeBuilder.build(this.state.files, {
                showUntracked: this.showUntracked,
            });
            this.state = { ...this.state, nodes };
            this.emit();
        }
    }

    getState(): ModifiedFilesState {
        return this.state;
    }

    onDidChange(listener: ModifiedFilesListener): vscode.Disposable {
        this.listeners.add(listener);
        return new vscode.Disposable(() => {
            this.listeners.delete(listener);
        });
    }

    dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
        this.watcher = undefined;
        this.listeners.clear();
    }

    private scheduleRefresh(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            this.refresh().catch(err =>
                console.error("[modifiedFiles] refresh failed:", err),
            );
        }, this.options.debounceMs);
    }

    private emit(): void {
        for (const l of this.listeners) l(this.state);
    }
}