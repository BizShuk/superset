// Sessions feature — read-only consumer of the `sessiond` JSONL store
// (plan `plans/2026-07-19-multi-agent-session-summary.md` §7).
//
// Layer 1: a TreeView listing every agent session recorded for the current
//          workspace folder, with size / turn count / age as dim text.
// Layer 2: clicking a row opens the session rendered as Markdown in the
//          editor, via a virtual read-only document.
//
// The extension never writes session content — the only writer here is the
// sample-data command, which exists because the Go side's LLM summary path
// is still unverified.

import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import { getTreeViewRegistry } from "../plugin/treeViewRegistry";
import { renderSessionMarkdown } from "./markdown";
import {
    clearSampleSessions,
    sampleCoverage,
    writeSampleSessions,
} from "./sampleData";
import { deleteSession, readSession, workspaceSessionsDir } from "./store";
import {
    SESSION_DOC_SCHEME,
    sessionDocUri,
    SessionsTreeProvider,
    sessionPathFromDocUri,
    type SessionsElement,
} from "./sessionsTreeProvider";

const VIEW_ID = "superset.sessions";

export function register(ctx: FeatureContext): FeatureHandle {
    const dataDirOverride = () =>
        vscode.workspace
            .getConfiguration("superset")
            .get<string>("sessions.dataDir") || undefined;

    const provider = new SessionsTreeProvider(
        ctx.workspaceFolder,
        dataDirOverride
    );
    provider.start();

    const view = vscode.window.createTreeView(VIEW_ID, {
        treeDataProvider: provider,
    });

    // Report active view for panel-layout persistence (same contract as the
    // TODO / mDNS panels).
    const visibilitySub = view.onDidChangeVisibility((visible) => {
        if (visible) {
            void vscode.commands.executeCommand(
                "superset.reportViewVisible",
                VIEW_ID
            );
        }
    });

    const treeViewEntry = getTreeViewRegistry()?.register(
        VIEW_ID,
        view as unknown as vscode.TreeView<unknown>,
        provider as unknown as vscode.TreeDataProvider<unknown>,
        ctx.shared.log
    );

    // ── Layer 2: virtual markdown document ────────────────────────────
    // `superset-session:/abs/path/to/<id>.jsonl.md` renders on demand, so
    // the document always reflects the file's current content and can be
    // refreshed in place when the ingestor appends a turn.
    const docChange = new vscode.EventEmitter<vscode.Uri>();
    const docProvider: vscode.TextDocumentContentProvider = {
        onDidChange: docChange.event,
        provideTextDocumentContent(uri) {
            const filePath = sessionPathFromDocUri(uri);
            if (!filePath) {
                return "# Session 已不存在\n\n檔案已被刪除或移動。";
            }
            const record = readSession(filePath);
            if (!record) {
                return "# Session 已不存在\n\n檔案已被刪除或移動。";
            }
            return renderSessionMarkdown(record);
        },
    };
    const docRegistration = vscode.workspace.registerTextDocumentContentProvider(
        SESSION_DOC_SCHEME,
        docProvider
    );

    const refreshAll = () => {
        provider.refresh();
        // Re-render any open summary documents so an appended turn shows up
        // without the user reopening the tab.
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme === SESSION_DOC_SCHEME) docChange.fire(doc.uri);
        }
    };

    const commands: vscode.Disposable[] = [
        vscode.commands.registerCommand("superset.sessionsRefresh", refreshAll),

        vscode.commands.registerCommand(
            "superset.sessionsOpenSummary",
            async (element?: SessionsElement) => {
                const record = asSession(element);
                if (!record) return;
                const doc = await vscode.workspace.openTextDocument(
                    sessionDocUri(record.filePath) as vscode.Uri
                );
                await vscode.languages.setTextDocumentLanguage(doc, "markdown");
                await vscode.window.showTextDocument(doc, { preview: true });
            }
        ),

        vscode.commands.registerCommand(
            "superset.sessionsCopyId",
            async (element?: SessionsElement) => {
                const record = asSession(element);
                if (!record) return;
                await vscode.env.clipboard.writeText(record.meta.session_id);
                void vscode.window.showInformationMessage(
                    `已複製 session id: ${record.meta.session_id}`
                );
            }
        ),

        vscode.commands.registerCommand(
            "superset.sessionsDelete",
            async (element?: SessionsElement) => {
                const record = asSession(element);
                if (!record) return;
                const answer = await vscode.window.showWarningMessage(
                    `刪除 session「${record.meta.title || record.meta.session_id}」?`,
                    { modal: true, detail: record.filePath },
                    "Delete"
                );
                if (answer !== "Delete") return;
                if (!deleteSession(record.filePath)) {
                    void vscode.window.showErrorMessage(
                        `刪除失敗: ${record.filePath}`
                    );
                    return;
                }
                ctx.shared.log(`sessions: deleted ${record.filePath}`);
                refreshAll();
            }
        ),

        vscode.commands.registerCommand("superset.sessionsSeedSample", () => {
            const written = writeSampleSessions(
                ctx.workspaceFolder,
                Date.now(),
                dataDirOverride()
            );
            ctx.shared.log(
                `sessions: seeded ${written.length} sample session(s) into ${workspaceSessionsDir(
                    ctx.workspaceFolder,
                    dataDirOverride()
                )}`
            );
            // The samples are a fixture matrix — log what each one proves so
            // "does the panel handle X?" is answerable from the output channel.
            for (const line of sampleCoverage()) {
                ctx.shared.log(`sessions:   ${line}`);
            }
            refreshAll();
            void vscode.window.showInformationMessage(
                `已產生 ${written.length} 筆 sample session`
            );
        }),

        vscode.commands.registerCommand("superset.sessionsClearSample", () => {
            const removed = clearSampleSessions(
                ctx.workspaceFolder,
                dataDirOverride()
            );
            refreshAll();
            void vscode.window.showInformationMessage(
                `已移除 ${removed} 筆 sample session`
            );
        }),
    ];

    ctx.resetHandlers.push(() => refreshAll());

    return {
        dispose() {
            for (const c of commands) c.dispose();
            docRegistration.dispose();
            docChange.dispose();
            treeViewEntry?.dispose();
            visibilitySub.dispose();
            view.dispose();
            provider.dispose();
        },
    };
}

function asSession(element?: SessionsElement) {
    return element && element.kind === "session" ? element.record : undefined;
}

