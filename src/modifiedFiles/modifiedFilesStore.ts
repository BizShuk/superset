import * as vscode from "vscode";
import * as gitStatusParser from "./gitStatusParser";
import * as treeBuilder from "./treeBuilder";
import type { ModifiedFile, TreeNode } from "./types";

const SCAN_TIMEOUT_MS = 10_000;

/**
 * Map raw spawn / git error messages to user-friendly strings. Strips the
 * Node.js `Command failed: <cmd>` prefix and the trailing git stderr dump;
 * surfaces only the most actionable line(s). Falls back to the raw message
 * if no known pattern matches.
 */
function friendlyGitError(raw: string, cwd: string): string {
    // Strip "Command failed: <cmd> <args>" wrapper added by child_process.
    const stripped = raw.replace(/^Command failed:[^\n]*\n?/, "").trim();
    if (/not a git repository/i.test(stripped)) {
        return `Not a git repository at ${cwd}. Run 'git init' or open a folder inside an existing git repo.`;
    }
    if (/dubious ownership/i.test(stripped)) {
        return `git reports dubious ownership of ${cwd}. Run 'git config --global --add safe.directory ${cwd}' to fix.`;
    }
    if (/timeout/i.test(stripped) || /timed out/i.test(stripped)) {
        return `git status timed out after ${SCAN_TIMEOUT_MS}ms — repo may be very large.`;
    }
    if (/Permission denied/i.test(stripped)) {
        return `Permission denied running git at ${cwd}. Check file/directory permissions.`;
    }
    // Default: first non-empty line of the cleaned message
    const firstLine = stripped.split("\n").find(l => l.trim()) ?? stripped;
    return firstLine;
}

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
    /**
     * Optional diagnostic logger. When provided, every refresh emits a line
     * (start / parse-count / error) so users can correlate panel state with
     * what's in `Superset: Show Diagnostic Logs`. Production wires this to
     * `ctx.shared.log`; tests omit it.
     */
    readonly log?: (msg: string) => void;
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
        this.options.log?.(`[modifiedFiles] refresh start cwd=${this.options.workspaceRoot}`);
        try {
            const result = await Promise.race([
                this.options.spawn("git", ["status", "--porcelain"]),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error(`git status timed out after ${SCAN_TIMEOUT_MS}ms`)),
                        SCAN_TIMEOUT_MS,
                    ),
                ),
            ]);
            this.options.log?.(
                `[modifiedFiles] git status: stdout=${result.stdout.length}B stderr=${result.stderr.length}B`,
            );
            const files = gitStatusParser.parse(result.stdout);
            this.options.log?.(`[modifiedFiles] parsed ${files.length} files`);
            const nodes = treeBuilder.build(files, { showUntracked: this.showUntracked });
            this.state = { kind: "ready", nodes, files, refreshedAt: this.options.clock() };
        } catch (err) {
            const rawMsg = err instanceof Error ? err.message : String(err);
            this.options.log?.(`[modifiedFiles] refresh failed: ${rawMsg}`);
            this.state = { kind: "error", message: friendlyGitError(rawMsg, this.options.workspaceRoot) };
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