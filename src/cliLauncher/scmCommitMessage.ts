// Selected Repo Path 與 Antigravity commit message command 的整合邊界。
// Antigravity 只接受 VS Code Git provider 已開啟的 repository，因此 generation
// 前先明確開啟目前 selection，並以 provider 回傳的 root 作為唯一 target。

import * as vscode from "vscode";

interface GitRepositoryApi {
    readonly rootUri: vscode.Uri;
}

interface GitApi {
    openRepository(rootUri: vscode.Uri): Promise<GitRepositoryApi | null>;
}

interface GitExtensionExports {
    getAPI(version: 1): GitApi;
}

const GIT_EXTENSION_ID = "vscode.git";
const GENERATE_COMMIT_MESSAGE_COMMAND =
    "antigravity.generateCommitMessage";

export async function generateCommitMessageForRepository(
    repositoryPath: string
): Promise<unknown> {
    const extension =
        vscode.extensions.getExtension<GitExtensionExports>(GIT_EXTENSION_ID);
    if (!extension) {
        throw new Error("VS Code Git extension is unavailable");
    }

    const exports = extension.isActive
        ? extension.exports
        : await extension.activate();
    const repository = await exports
        .getAPI(1)
        .openRepository(vscode.Uri.file(repositoryPath));
    if (!repository) {
        throw new Error("No git repository found for selected Repo Link");
    }

    return vscode.commands.executeCommand<unknown>(
        GENERATE_COMMIT_MESSAGE_COMMAND,
        repository.rootUri.fsPath
    );
}
