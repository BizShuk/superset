import * as vscode from "vscode";
import type { FsAdapter } from "./explorerStore";

/**
 * Real `FsAdapter` backed by `vscode.workspace.fs` and `vscode.workspace`.
 * This is the only place where `vscode` APIs touch the explorer data layer;
 * the `ExplorerStore` itself stays pure and testable.
 */
export class VscodeFsAdapter implements FsAdapter {
    async readDirectory(
        uri: string
    ): Promise<Array<{ name: string; isDirectory: boolean }>> {
        const dirUri = vscode.Uri.file(uri);
        const entries = await vscode.workspace.fs.readDirectory(dirUri);
        return entries.map(([name, type]) => ({
            name,
            isDirectory:
                type === vscode.FileType.Directory ||
                (type & vscode.FileType.Directory) !== 0,
        }));
    }

    getWorkspaceRoots(): string[] {
        return (
            vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? []
        );
    }

    onDidChangeWorkspace(cb: () => void): () => void {
        const d = vscode.workspace.onDidChangeWorkspaceFolders(() => cb());
        return () => d.dispose();
    }

    onDidChangeFiles(cb: (uris: string[]) => void): () => void {
        const watcher = vscode.workspace.createFileSystemWatcher("**/*");
        const onChanged = (uri: vscode.Uri) => cb([uri.fsPath]);
        const subs = [
            watcher.onDidCreate(onChanged),
            watcher.onDidDelete(onChanged),
        ];
        return () => {
            for (const s of subs) s.dispose();
            watcher.dispose();
        };
    }
}