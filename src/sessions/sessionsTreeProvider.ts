// vscode-bound TreeDataProvider for the Sessions panel.
//
// Two-level tree: session-bearing projects under the current workspace, then
// each project's sessions. Clicking a session opens its rendered Markdown.

import * as path from "path";
import * as vscode from "vscode";
import { listSessionProjects, watchSessions } from "./store";
import { buildSessionRow } from "./treeSpec";
import type { SessionProject, SessionRecord } from "./types";

export const SESSION_CONTEXT_VALUE = "supersetSession";

export {
    SESSION_DOC_SCHEME,
    sessionDocUri,
    sessionPathFromDocUri,
} from "./docUri";

/** A project group, session row, or the placeholder shown on an empty store. */
export type SessionsElement =
    | { readonly kind: "project"; readonly project: SessionProject }
    | { readonly kind: "session"; readonly record: SessionRecord }
    | { readonly kind: "empty" };

export class SessionsTreeProvider
    implements vscode.TreeDataProvider<SessionsElement>
{
    private readonly emitter = new vscode.EventEmitter<
        SessionsElement | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;

    private watcher?: { dispose(): void };
    private projects: SessionProject[] = [];

    constructor(
        private readonly workspaceFolder: string,
        private readonly dataDirOverride: () => string | undefined
    ) {}

    start(): void {
        if (this.watcher) return;
        this.reload();
        this.watcher = watchSessions(
            this.workspaceFolder,
            () => this.refresh(),
            this.dataDirOverride()
        );
    }

    dispose(): void {
        this.watcher?.dispose();
        this.watcher = undefined;
        this.emitter.dispose();
    }

    refresh(): void {
        this.reload();
        this.emitter.fire(undefined);
    }

    private reload(): void {
        this.projects = listSessionProjects(
            this.workspaceFolder,
            this.dataDirOverride()
        );
    }

    getTreeItem(element: SessionsElement): vscode.TreeItem {
        if (element.kind === "empty") {
            const item = new vscode.TreeItem(
                "尚無 session 記錄",
                vscode.TreeItemCollapsibleState.None
            );
            item.description = "點擊產生 sample 資料";
            item.iconPath = new vscode.ThemeIcon("beaker");
            item.command = {
                command: "superset.sessionsSeedSample",
                title: "Seed sample sessions",
            };
            return item;
        }

        if (element.kind === "project") {
            const { projectPath, sessions } = element.project;
            const relative = path.relative(this.workspaceFolder, projectPath);
            const label = relative || path.basename(projectPath);
            const item = new vscode.TreeItem(
                label,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            item.description = `${sessions.length} session${
                sessions.length === 1 ? "" : "s"
            }`;
            item.tooltip = projectPath;
            item.iconPath = new vscode.ThemeIcon("folder");
            return item;
        }

        const spec = buildSessionRow(element.record, Date.now());
        const item = new vscode.TreeItem(
            spec.label,
            vscode.TreeItemCollapsibleState.None
        );
        item.description = spec.description;
        item.tooltip = spec.tooltip;
        item.iconPath = new vscode.ThemeIcon(spec.iconId);
        item.contextValue = SESSION_CONTEXT_VALUE;
        item.command = {
            command: "superset.sessionsOpenSummary",
            title: "Open session summary",
            arguments: [element],
        };
        return item;
    }

    getChildren(element?: SessionsElement): SessionsElement[] {
        if (element?.kind === "project") {
            return element.project.sessions.map((record) => ({
                kind: "session" as const,
                record,
            }));
        }
        if (element) return [];
        if (this.projects.length === 0) return [{ kind: "empty" }];
        return this.projects.map((project) => ({
            kind: "project" as const,
            project,
        }));
    }
}
