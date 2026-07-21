// git — registers `superset.gitResetHard` / `superset.gitResetSoft`
// and wires them so they appear in VSCode's Source Control Graph
// commit context menu (via `scm/historyItem/context` in
// `package.json`). Pure helpers live in `./gitReset.ts`; this file
// is the thin orchestration layer that handles UI prompts, terminal
// spawning, and SCM panel refresh.
//
// Both commands dispatch through `spawnRunTerminal` so the user
// sees the git operation in a PTY-backed terminal and can Ctrl-C
// if needed — same pattern as `installCommands.ts`. `reset --hard`
// requires a modal confirmation because it's destructive;
// `reset --soft` does not, since it only moves the HEAD pointer.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import { getTerminalSpawner } from "../crossModuleState";
import { spawnRunTerminal } from "../spawnRunTerminal";
import {
    type HistoryItemLike,
    type RepositoryLike,
    type ResetMode,
    buildResetCmdline,
    formatResetHardWarning,
    parseScmArgs,
    shortSha,
} from "./gitReset";
import {
    copyMissingTree,
    isGitRepository,
    linkGitHooks,
    readLocalHooksPath,
} from "./gitHooks";
import {
    buildGitHubFileUrl,
    selectGitHubRemote,
} from "./githubUrl";

interface GitRemoteApi {
    readonly name: string;
    readonly fetchUrl?: string;
    readonly pushUrl?: string;
}

interface GitRepositoryApi {
    readonly rootUri: vscode.Uri;
    readonly state: { readonly remotes: readonly GitRemoteApi[] };
}

interface GitApi {
    getRepository(uri: vscode.Uri): GitRepositoryApi | null;
}

interface GitExtensionExports {
    getAPI(version: 1): GitApi;
}

/**
 * Inline limit for the delay between firing the reset into the
 * spawned terminal and issuing `git.refresh` so the Source Control
 * Graph panel re-fetches with the new HEAD. 1000ms is short enough
 * to feel instant on a typical local repo but long enough that the
 * git ref-update has landed and the file watcher hasn't yet — the
 * manual refresh then wins the race instead of being a no-op.
 */
const GIT_REFRESH_DELAY_MS = 1_000;
const INSTALL_GIT_HOOKS_COMMAND = "superset.installGitHooks";
const LINK_GIT_HOOKS_COMMAND = "superset.linkGitHooks";

function firstOpenedFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
}

async function requireOpenedGitFolder(): Promise<vscode.WorkspaceFolder | null> {
    const folder = firstOpenedFolder();
    if (!folder) {
        await vscode.window.showErrorMessage(
            "Superset: No opened folder in this VS Code window"
        );
        return null;
    }
    if (folder.uri.scheme !== "file") {
        await vscode.window.showErrorMessage(
            "Superset: Git hooks require a local opened folder"
        );
        return null;
    }
    if (!(await isGitRepository(folder.uri.fsPath))) {
        await vscode.window.showErrorMessage(
            "Superset: Opened folder is not a Git repository"
        );
        return null;
    }
    return folder;
}

async function refreshGitHooksStatus(
    statusBar: vscode.StatusBarItem,
    ctx: FeatureContext
): Promise<void> {
    const folder = firstOpenedFolder();
    if (!folder || folder.uri.scheme !== "file") {
        statusBar.hide();
        return;
    }

    const root = folder.uri.fsPath;
    if (
        !fs.existsSync(path.join(root, ".githooks")) ||
        !(await isGitRepository(root))
    ) {
        statusBar.hide();
        return;
    }

    try {
        const hooksPath = await readLocalHooksPath(root);
        if (hooksPath) {
            statusBar.hide();
        } else {
            statusBar.show();
        }
    } catch (error) {
        ctx.shared.log(
            `git: failed to inspect local core.hooksPath: ${error}`
        );
    }
}

async function linkOpenedFolderGitHooks(
    statusBar: vscode.StatusBarItem,
    ctx: FeatureContext
): Promise<void> {
    const folder = await requireOpenedGitFolder();
    if (!folder) return;

    try {
        await linkGitHooks(folder.uri.fsPath);
        await refreshGitHooksStatus(statusBar, ctx);
        await vscode.window.showInformationMessage(
            "Superset: Linked Git hooks with local core.hooksPath=.githooks"
        );
    } catch (error) {
        ctx.shared.log(`git: link hooks failed: ${error}`);
        await vscode.window.showErrorMessage(
            `Superset: Failed to link Git hooks: ${error}`
        );
    }
}

async function installOpenedFolderGitHooks(
    statusBar: vscode.StatusBarItem,
    ctx: FeatureContext
): Promise<void> {
    const folder = await requireOpenedGitFolder();
    if (!folder) return;

    const templateRoot = path.join(
        ctx.context.extensionUri.fsPath,
        "pkg",
        "resources",
        "git",
        "githooks"
    );
    const targetRoot = path.join(folder.uri.fsPath, ".githooks");

    try {
        const result = await copyMissingTree(templateRoot, targetRoot);
        await linkGitHooks(folder.uri.fsPath);
        await refreshGitHooksStatus(statusBar, ctx);
        await vscode.window.showInformationMessage(
            `Superset: Git hooks installed (${result.copied} added, ${result.skipped} kept) and linked`
        );
    } catch (error) {
        ctx.shared.log(`git: install hooks failed: ${error}`);
        await vscode.window.showErrorMessage(
            `Superset: Failed to install Git hooks: ${error}`
        );
    }
}

/**
 * Notification copy used when the command is invoked from the
 * command palette (no SCM context). Tells the user the entry point
 * they need.
 */
const PALETTE_HINT_PREFIX =
    "Superset: 請從 Source Control Graph panel 的 commit 上";

/**
 * Dispatch a `git reset --<mode>` for the commit at the right-click.
 * Shared between the hard and soft commands — only the
 * confirmation gate differs.
 */
async function dispatchReset(
    mode: ResetMode,
    args: unknown[],
    ctx: FeatureContext
): Promise<void> {
    const log = ctx.shared.log;
    const parsed = parseScmArgs(args);
    if (!parsed.repository || !parsed.historyItem) {
        log(
            `git: reset --${mode} called without SCM context ` +
                `(likely command palette invocation)`
        );
        await vscode.window.showInformationMessage(
            `${PALETTE_HINT_PREFIX} 右鍵執行 reset --${mode}。`
        );
        return;
    }

    if (!getTerminalSpawner()) {
        vscode.window.showErrorMessage(
            "Superset: Terminals 模組尚未啟用,請稍候再試"
        );
        log(
            `git: reset --${mode} aborted — terminal spawner not wired`
        );
        return;
    }

    // Hard is destructive; gate it behind a modal confirmation
    // showing the short SHA + subject. Soft only moves the HEAD
    // pointer (working tree + index untouched) so it runs as-is.
    if (mode === "hard") {
        const warning = formatResetHardWarning(
            parsed.historyItem.id,
            parsed.historyItem.message
        );
        const choice = await vscode.window.showWarningMessage(
            warning,
            { modal: true },
            "Reset Hard",
            "Cancel"
        );
        if (choice !== "Reset Hard") {
            log(`git: reset --hard cancelled by user at confirmation modal`);
            return;
        }
    }

    const sha = parsed.historyItem.id;
    const cwd = parsed.repository.rootUri?.fsPath ?? ctx.workspaceFolder;
    const cmdline = buildResetCmdline(sha, mode);

    await spawnRunTerminal(
        `Superset: Reset --${mode} (${shortSha(sha)})`,
        cmdline,
        { closeOnSuccess: true, cwd }
    );
    log(
        `git: reset --${mode} dispatched for ${shortSha(sha)} cwd=${cwd}`
    );

    // Force the SCM Graph panel to re-fetch so the new HEAD shows
    // up immediately. Built-in git watches `.git/`, but on some
    // setups the lag is jarring after an explicit reset. We swallow
    // refresh errors (e.g. when the built-in git extension is
    // disabled) — they're cosmetic and never block the reset.
    setTimeout(() => {
        vscode.commands.executeCommand("git.refresh").then(
            () => {},
            (err: unknown) => {
                log(`git: post-reset git.refresh failed: ${err}`);
            }
        );
    }, GIT_REFRESH_DELAY_MS);
}

async function getGitApi(): Promise<GitApi | null> {
    const extension =
        vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
    if (!extension) return null;

    try {
        const exports = extension.isActive
            ? extension.exports
            : await extension.activate();
        return exports.getAPI(1);
    } catch {
        return null;
    }
}

async function copyGitHubUrl(
    uri: vscode.Uri | undefined,
    ctx: FeatureContext
): Promise<void> {
    if (!uri || uri.scheme !== "file") {
        await vscode.window.showErrorMessage(
            "Superset: 請從 Explorer 的本機檔案右鍵執行 Copy GitHub URL"
        );
        return;
    }

    const api = await getGitApi();
    const repository = api?.getRepository(uri) ?? null;
    if (!repository) {
        await vscode.window.showErrorMessage(
            "Superset: 找不到檔案所屬的 Git repository"
        );
        return;
    }

    const remote = selectGitHubRemote(repository.state.remotes);
    if (!remote) {
        await vscode.window.showErrorMessage(
            "Superset: repository 沒有 GitHub remote"
        );
        return;
    }

    const url = buildGitHubFileUrl(
        remote,
        repository.rootUri.fsPath,
        uri.fsPath
    );
    if (!url) {
        await vscode.window.showErrorMessage(
            "Superset: 無法建立 repository-relative GitHub URL"
        );
        return;
    }

    await vscode.env.clipboard.writeText(url);
    await vscode.window.showInformationMessage(
        "Superset: GitHub URL copied"
    );
    ctx.shared.log(`git: copied GitHub URL ${url}`);
}

export function register(ctx: FeatureContext): FeatureHandle {
    const hookStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left
    );
    hookStatusBar.text = "$(link) Git hooks not linked";
    hookStatusBar.tooltip =
        "This opened folder contains .githooks, but local core.hooksPath is not set.";
    hookStatusBar.command = LINK_GIT_HOOKS_COMMAND;
    hookStatusBar.hide();

    ctx.subscriptions.push(
        hookStatusBar,
        vscode.commands.registerCommand(
            "superset.gitResetHard",
            (...args: unknown[]) =>
                void dispatchReset("hard", args, ctx)
        ),
        vscode.commands.registerCommand(
            "superset.gitResetSoft",
            (...args: unknown[]) =>
                void dispatchReset("soft", args, ctx)
        ),
        vscode.commands.registerCommand(
            "superset.copyGitHubUrl",
            (uri: vscode.Uri | undefined) => copyGitHubUrl(uri, ctx)
        ),
        vscode.commands.registerCommand(
            INSTALL_GIT_HOOKS_COMMAND,
            () => installOpenedFolderGitHooks(hookStatusBar, ctx)
        ),
        vscode.commands.registerCommand(
            LINK_GIT_HOOKS_COMMAND,
            () => linkOpenedFolderGitHooks(hookStatusBar, ctx)
        )
    );

    void refreshGitHooksStatus(hookStatusBar, ctx);

    ctx.shared.log("git: registered");

    return {
        dispose() {
            // Every disposable is bridged to the plugin pool via
            // the `subscriptions.push` interceptor in
            // `featureContext.ts`; nothing extra to clean up here.
        },
    };
}

// Re-export the helpers so unit tests in `test/gitPlugin.test.ts`
// can exercise behavior without importing the vscode-bound index.ts
// directly. The two consumers are:
//   - `test/gitReset.test.ts` — pure-function tests against the
//     helpers in `./gitReset.ts`
//   - `test/gitPlugin.test.ts` — `assertPluginContract(...)` check
//     against the shim in `./plugin.ts`
export type { HistoryItemLike, RepositoryLike };
