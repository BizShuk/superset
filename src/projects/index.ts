import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import { ProjectStore } from "./projectStore";
import { ProjectsTreeProvider } from "./treeProvider";

export function register(ctx: FeatureContext): FeatureHandle {
    const store = new ProjectStore();
    store.start();

    const provider = new ProjectsTreeProvider(store);
    provider.start();

    ctx.resetHandlers.push(() => {
        store.reset();
        provider.refresh();
    });

    const view = vscode.window.createTreeView("superset.projects", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    const openCmd = vscode.commands.registerCommand(
        "superset.openProject",
        async (projectPath: string) => {
            if (!projectPath) return;
            const uri = vscode.Uri.file(projectPath);
            await vscode.commands.executeCommand("vscode.openFolder", uri, {
                forceNewWindow: true,
            });
        }
    );

    const refreshCmd = vscode.commands.registerCommand(
        "superset.refreshProjects",
        async () => {
            await store.scan();
            provider.refresh();
        }
    );

    ctx.subscriptions.push(
        openCmd,
        refreshCmd,
        view,
        { dispose: () => provider.stop() },
        { dispose: () => store.stop() }
    );

    return {
        dispose() {
            provider.stop();
            store.stop();
            openCmd.dispose();
            refreshCmd.dispose();
            view.dispose();
        },
    };
}
