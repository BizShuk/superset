// Git integration: Explorer GitHub URL 與 repository-local hooks management。

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { PluginContext } from "../plugin";
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
    ctx: PluginContext
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
        ctx.log(
            `git: failed to inspect local core.hooksPath: ${error}`
        );
    }
}

async function linkOpenedFolderGitHooks(
    statusBar: vscode.StatusBarItem,
    ctx: PluginContext
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
        ctx.log(`git: link hooks failed: ${error}`);
        await vscode.window.showErrorMessage(
            `Superset: Failed to link Git hooks: ${error}`
        );
    }
}

async function installOpenedFolderGitHooks(
    statusBar: vscode.StatusBarItem,
    ctx: PluginContext
): Promise<void> {
    const folder = await requireOpenedGitFolder();
    if (!folder) return;

    const templateRoot = path.join(
        ctx.extensionUri.fsPath,
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
        ctx.log(`git: install hooks failed: ${error}`);
        await vscode.window.showErrorMessage(
            `Superset: Failed to install Git hooks: ${error}`
        );
    }
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
    ctx: PluginContext
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
    ctx.log(`git: copied GitHub URL ${url}`);
}

export function register(ctx: PluginContext): void {
    const hookStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left
    );
    hookStatusBar.text = "$(link) Git hooks not linked";
    hookStatusBar.tooltip =
        "This opened folder contains .githooks, but local core.hooksPath is not set.";
    hookStatusBar.command = LINK_GIT_HOOKS_COMMAND;
    hookStatusBar.hide();

    for (const disposable of [
        hookStatusBar,
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
        ),
    ]) {
        ctx.registerDisposable(disposable);
    }

    void refreshGitHooksStatus(hookStatusBar, ctx);

    ctx.log("git: registered");
}
