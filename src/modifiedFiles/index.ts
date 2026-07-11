import { execFile, spawnSync } from "child_process";
import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import { registerModifiedFilesCommands } from "./commands";
import { ModifiedFilesStore } from "./modifiedFilesStore";
import { ModifiedFilesTreeProvider } from "./treeProvider";

export function register(ctx: FeatureContext): FeatureHandle {
    const fsPath = ctx.workspaceFolder;

    // Case 1: no workspace folder
    if (!fsPath) {
        return makeMessageOnlyView(ctx, "Open a folder to use Modified Files");
    }

    // Case 2: validate git repo (synchronous — fail fast on activation)
    const repoRoot = detectGitRoot(fsPath);
    if (!repoRoot) {
        return makeMessageOnlyView(ctx, "Not a git repository");
    }

    // Case 3: normal path
    // Default debounceMs; future enhancement could surface this via a
    // command-palette quickPick (current pattern across the project).
    const debounceMs = 500;

    const store = new ModifiedFilesStore({
        workspaceRoot: repoRoot,
        debounceMs,
        spawn: spawnExecFile,
        clock: () => Date.now(),
    });

    const provider = new ModifiedFilesTreeProvider(store, repoRoot);
    const view = vscode.window.createTreeView("superset.modifiedFiles", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    store.start().catch(err => {
        ctx.shared.log(`[modifiedFiles] start failed: ${err}`);
    });

    const cmds = registerModifiedFilesCommands(ctx.context, store, repoRoot);

    ctx.subscriptions.push(view, ...cmds, provider);
    ctx.resetHandlers.push(() => store.refresh());

    return {
        dispose: () => {
            store.dispose();
            // view and cmds are auto-disposed via ctx.subscriptions
        },
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function detectGitRoot(fsPath: string): string | null {
    try {
        const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
            cwd: fsPath,
            encoding: "utf-8",
        });
        const stdout = (result.stdout ?? "").trim();
        if (stdout && result.status === 0) return stdout;
    } catch {
        // fallthrough
    }
    return null;
}

function makeMessageOnlyView(ctx: FeatureContext, message: string): FeatureHandle {
    const provider = new MessageOnlyProvider(message);
    const view = vscode.window.createTreeView("superset.modifiedFiles", {
        treeDataProvider: provider,
    });
    ctx.subscriptions.push(view, provider);
    return { dispose: () => view.dispose() };
}

/**
 * Minimal TreeDataProvider that displays a single message. Used when the
 * panel cannot usefully render — no workspace or not a git repo.
 */
class MessageOnlyProvider implements vscode.TreeDataProvider<{ readonly message: string }> {
    private readonly emitter = new vscode.EventEmitter<{ message: string } | undefined>();
    readonly onDidChangeTreeData: vscode.Event<{ message: string } | undefined> =
        this.emitter.event;

    constructor(private readonly message: string) {}

    getTreeItem(element: { message: string }): vscode.TreeItem {
        const item = new vscode.TreeItem(element.message);
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        return item;
    }

    getChildren(): { message: string }[] {
        return [{ message: this.message }];
    }

    dispose(): void {
        this.emitter.dispose();
    }
}

/**
 * Promise wrapper around child_process.execFile. Resolves with stdout/stderr
 * on success, rejects on non-zero exit. Production spawn — tests inject fakes
 * via `ModifiedFilesStoreOptions.spawn`.
 */
function spawnExecFile(
    cmd: string,
    args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(
            cmd,
            [...args],
            { maxBuffer: 16 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve({ stdout: String(stdout), stderr: String(stderr) });
            },
        );
    });
}