// vscode-bound TreeDataProvider for the Sessions panel.
//
// Flat, single-level list: one row per session recorded for the current
// workspace folder. The second layer of the feature is not a tree level —
// it is the rendered Markdown document opened in the editor (`markdown.ts`).

import * as vscode from "vscode";
import { listSessions, watchSessions } from "./store";
import { buildSessionRow } from "./treeSpec";
import type { SessionRecord } from "./types";

export const SESSION_CONTEXT_VALUE = "supersetSession";

export {
    SESSION_DOC_SCHEME,
    sessionDocUri,
    sessionPathFromDocUri,
} from "./docUri";

/** A session row, or the single placeholder row shown on an empty store. */
export type SessionsElement =
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
    private records: SessionRecord[] = [];

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
        this.records = listSessions(this.workspaceFolder, this.dataDirOverride());
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
        if (element) return [];
        if (this.records.length === 0) return [{ kind: "empty" }];
        return this.records.map((record) => ({
            kind: "session" as const,
            record,
        }));
    }
}
