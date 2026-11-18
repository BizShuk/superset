// Git integration: Explorer GitHub URL。

import * as vscode from "vscode";
import type { PluginContext } from "../plugin";
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
    ctx.registerDisposable(
        vscode.commands.registerCommand(
            "superset.copyGitHubUrl",
            (uri: vscode.Uri | undefined) => copyGitHubUrl(uri, ctx)
        )
    );

    ctx.log("git: registered");
}
