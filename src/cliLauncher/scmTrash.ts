// CLI SCM untracked files 的 recoverable deletion adapter。

import * as vscode from "vscode";

export async function trashSCMFile(absolutePath: string): Promise<void> {
    await vscode.workspace.fs.delete(vscode.Uri.file(absolutePath), {
        recursive: true,
        useTrash: true,
    });
}
