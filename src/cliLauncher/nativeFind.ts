// CLI Launcher 的 VS Code native Tree/List Find Control 入口。

import * as vscode from "vscode";

/**
 * 每次 activation 只套用一次 CLI View 的初始 Find toggles；之後保留使用者在
 * native control 內選擇的 Filter / Highlight 與 Fuzzy / Contiguous 狀態。
 */
export function createNativeFindHandler(viewID: string): () => Promise<void> {
    let defaultsApplied = false;

    return async () => {
        await vscode.commands.executeCommand(`${viewID}.focus`);

        if (!defaultsApplied) {
            const listConfig =
                vscode.workspace.getConfiguration("workbench.list");
            const mode = listConfig.get<string>(
                "defaultFindMode",
                "highlight"
            );
            const matchType = listConfig.get<string>(
                "defaultFindMatchType",
                "fuzzy"
            );

            if (mode !== "filter") {
                await vscode.commands.executeCommand("list.toggleFindMode");
            }
            if (matchType !== "fuzzy") {
                await vscode.commands.executeCommand(
                    "list.toggleFindMatchType"
                );
            }
            defaultsApplied = true;
        }

        await vscode.commands.executeCommand("list.find");
    };
}
