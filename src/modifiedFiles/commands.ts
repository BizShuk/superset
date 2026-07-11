import * as path from "path";
import * as vscode from "vscode";
import type { ModifiedFilesStore } from "./modifiedFilesStore";

export function registerModifiedFilesCommands(
    ctx: vscode.ExtensionContext,
    store: ModifiedFilesStore,
    repoRoot: string,
): vscode.Disposable[] {
    const toAbsolute = (p: string): string =>
        path.isAbsolute(p) ? p : path.join(repoRoot, p);

    return [
        vscode.commands.registerCommand("superset.modifiedFiles.refresh", () => {
            return store.refresh();
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.toggleUntracked", () => {
            store.toggleUntracked();
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.revealInExplorer", (arg?: { path: string }) => {
            if (!arg?.path) return;
            // Use revealFileInOS (cross-platform) — revealInExplorer only works for
            // files already visible in the native Explorer tree.
            vscode.commands.executeCommand(
                "revealFileInOS",
                vscode.Uri.file(toAbsolute(arg.path)),
            );
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.copyPath", (arg?: { path: string }) => {
            if (!arg?.path) return;
            vscode.env.clipboard.writeText(toAbsolute(arg.path));
        }),

        vscode.commands.registerCommand("superset.modifiedFiles.copyRelativePath", (arg?: { path: string }) => {
            if (!arg?.path) return;
            vscode.env.clipboard.writeText(arg.path);
        }),
    ];
}