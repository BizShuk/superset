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
    const cwd = resolveCwd(parsed.repository, ctx.workspaceFolder);
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

/**
 * Anchor the spawned terminal to the repo root when we have one;
 * fall back to the workspace folder so the command still does
 * something sensible in the (uncommon) case where the SCM provider
 * has no `rootUri` (e.g. detached history).
 */
function resolveCwd(
    repository: RepositoryLike,
    workspaceFolder: string
): string {
    return repository.rootUri?.fsPath ?? workspaceFolder;
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
    ctx.subscriptions.push(
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
        )
    );

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
