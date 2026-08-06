// CLI View Container 內的 native `Change` Tree View。
//
// Change groups、compact folders、file resources 與 inline actions 全部交給
// VS Code TreeView renderer；Extension Host 只維護目前 selection 對應的安全資料。

import * as path from "node:path";
import * as vscode from "vscode";
import type { CLIEntry } from "./entries";
import type { SCMActionService } from "./scmActions";
import { generateCommitMessageForRepository } from "./scmCommitMessage";
import type { SCMDiffProvider } from "./scmDiff";
import { resolveRepositoryPath } from "./scmPath";
import type { GitSCMRepository } from "./scmRepository";
import type {
    GitChange,
    GitChangeGroup,
    GitChangeMarker,
} from "./scmStatus";

export const CHANGE_VIEW_ID = "superset.cliLauncher.changes";
export const HAS_STAGED_CHANGES_CONTEXT_KEY =
    "superset.cliLauncher.hasStagedChanges";

export const SCM_TREE_CONTEXT_VALUES: Record<GitChangeGroup, string> = {
    staged: "superset.cliLauncher.scm.staged",
    unstaged: "superset.cliLauncher.scm.unstaged",
    untracked: "superset.cliLauncher.scm.untracked",
};

export type SCMChangeAction = "stage" | "unstage" | "discard";

type RepositoryChanged = () => void | Promise<void>;
type Log = (message: string) => void;
type TreeNodeKind = "group" | "folder" | "change";

const CHANGE_GROUPS: readonly GitChangeGroup[] = [
    "staged",
    "unstaged",
    "untracked",
];

const GROUP_TITLES: Record<GitChangeGroup, string> = {
    staged: "Staged Changes",
    unstaged: "Unstaged Changes",
    untracked: "Untracked Changes",
};

const MARKER_LABELS: Record<GitChangeMarker, string> = {
    U: "Updated",
    A: "Added",
    "!": "Conflict",
    D: "Deleted",
};

interface ChangeReference {
    readonly change: GitChange;
}

interface FolderBranch {
    readonly folders: Map<string, FolderBranch>;
    readonly changes: ChangeReference[];
}

function createBranch(): FolderBranch {
    return { folders: new Map(), changes: [] };
}

function insertChange(branch: FolderBranch, change: GitChange): void {
    const parts = change.path.split("/");
    parts.pop();
    let current = branch;
    for (const segment of parts) {
        if (segment === "") {
            continue;
        }
        let next = current.folders.get(segment);
        if (!next) {
            next = createBranch();
            current.folders.set(segment, next);
        }
        current = next;
    }
    current.changes.push({ change });
}

function displayPath(change: GitChange): string {
    return change.originalPath
        ? `${change.originalPath} → ${change.path}`
        : change.path;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function supportsAction(
    group: GitChangeGroup,
    action: SCMChangeAction
): boolean {
    if (action === "discard") {
        return true;
    }
    return group === "staged" ? action === "unstage" : action === "stage";
}

function toNodeID(value: unknown): string | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }
    const id = (value as { scmNodeID?: unknown }).scmNodeID;
    return typeof id === "string" ? id : undefined;
}

export class SCMTreeItem extends vscode.TreeItem {

    constructor(
        readonly scmNodeID: string,
        readonly kind: TreeNodeKind,
        readonly group: GitChangeGroup,
        readonly changes: readonly GitChange[],
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.contextValue = SCM_TREE_CONTEXT_VALUES[group];
    }
}

export class CLIChangesTreeProvider
    implements vscode.TreeDataProvider<SCMTreeItem>, vscode.Disposable
{
    private readonly treeEmitter = new vscode.EventEmitter<
        SCMTreeItem | undefined
    >();
    readonly onDidChangeTreeData = this.treeEmitter.event;

    private readonly messageEmitter = new vscode.EventEmitter<
        string | undefined
    >();
    readonly onDidChangeMessage = this.messageEmitter.event;

    private selected: CLIEntry | undefined;
    private changes: GitChange[] = [];
    private roots: SCMTreeItem[] = [];
    private readonly items = new Map<string, SCMTreeItem>();
    private readonly children = new Map<string, SCMTreeItem[]>();
    private revision = 0;
    private nextNodeID = 0;
    private busy = false;
    private commitDraft = "";
    private _message: string | undefined =
        "請在 Repo Path 選取一個 repository。";

    constructor(
        private readonly repository: GitSCMRepository,
        private readonly actions: Pick<
            SCMActionService,
            "stage" | "unstage" | "discard"
        >,
        private readonly diff: Pick<SCMDiffProvider, "open">,
        private readonly onRepositoryChanged: RepositoryChanged = () =>
            undefined,
        private readonly log: Log = () => undefined
    ) {}

    get message(): string | undefined {
        return this._message;
    }

    getTreeItem(element: SCMTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SCMTreeItem): Promise<SCMTreeItem[]> {
        if (!element) {
            return [...this.roots];
        }
        return [...(this.children.get(element.scmNodeID) ?? [])];
    }

    async setSelection(entries: readonly CLIEntry[]): Promise<void> {
        const unique = [
            ...new Map(entries.map((entry) => [entry.path, entry])).values(),
        ];
        this.commitDraft = "";

        if (unique.length === 0) {
            this.revision += 1;
            this.clearTree();
            this.selected = undefined;
            this.setMessage("請在 Repo Path 選取一個 repository。");
            this.updateStagedContext();
            return;
        }
        if (unique.length > 1) {
            this.revision += 1;
            this.clearTree();
            this.selected = undefined;
            this.setMessage(
                "一次只能檢視一個 repository，請在 Repo Path 保留單一選取。"
            );
            this.updateStagedContext();
            return;
        }

        this.selected = unique[0];
        await this.loadSelected();
    }

    async refresh(): Promise<void> {
        if (!this.selected) {
            this.fireTreeChange();
            return;
        }
        await this.loadSelected();
    }

    async openChange(target: unknown): Promise<void> {
        const selected = this.selected;
        const node = this.resolveNode(target);
        const change = node?.kind === "change" ? node.changes[0] : undefined;
        if (!selected || !change) {
            return;
        }

        try {
            await this.diff.open(selected.path, change);
        } catch (error: unknown) {
            const detail = describeError(error);
            this.log(`cliLauncher changes: diff failed — ${detail}`);
            await vscode.window.showErrorMessage(
                `CLI Change: 無法開啟 Diff Editor — ${detail}`
            );
        }
    }

    async runAction(action: SCMChangeAction, target: unknown): Promise<void> {
        const selected = this.selected;
        const node = this.resolveNode(target);
        if (
            this.busy ||
            !selected ||
            !node ||
            node.changes.length === 0 ||
            !supportsAction(node.group, action)
        ) {
            return;
        }

        const requestRevision = this.revision;
        if (action === "discard") {
            const count = node.changes.length;
            const choice = await vscode.window.showWarningMessage(
                `Discard ${count} change${count === 1 ? "" : "s"}? Tracked changes cannot be recovered by Git; untracked files move to Trash.`,
                { modal: true },
                "Discard"
            );
            if (
                choice !== "Discard" ||
                requestRevision !== this.revision ||
                this.selected?.path !== selected.path
            ) {
                return;
            }
        }

        this.busy = true;
        try {
            if (action === "stage") {
                await this.actions.stage(selected.path, node.changes);
            } else if (action === "unstage") {
                await this.actions.unstage(selected.path, node.changes);
            } else {
                await this.actions.discard(selected.path, node.changes);
            }

            if (this.selected?.path === selected.path) {
                await this.loadSelected();
            }
            await this.notifyRepositoryChanged();
        } catch (error: unknown) {
            const detail = describeError(error);
            this.log(`cliLauncher changes: ${action} failed — ${detail}`);
            if (this.selected?.path === selected.path) {
                await this.loadSelected();
            }
            await vscode.window.showErrorMessage(
                `CLI Change: ${action} 失敗 — ${detail}`
            );
        } finally {
            this.busy = false;
        }
    }

    async commitStaged(): Promise<void> {
        await this.promptAndCommit(this.commitDraft);
    }

    async generateCommitMessage(): Promise<void> {
        const selected = this.selected;
        const requestRevision = this.revision;
        if (this.busy || !selected || !this.hasStagedChanges()) {
            return;
        }

        this.busy = true;
        try {
            const generated = await generateCommitMessageForRepository(
                selected.path
            );
            if (
                !this.isCurrent(requestRevision, selected.path) ||
                typeof generated !== "string" ||
                generated.trim() === ""
            ) {
                return;
            }

            this.commitDraft = generated.trim();
            await this.restoreChangeView();
        } catch (error: unknown) {
            const detail = describeError(error);
            this.log(
                `cliLauncher changes: generate commit message failed — ${detail}`
            );
            if (this.isCurrent(requestRevision, selected.path)) {
                await vscode.window.showErrorMessage(
                    `CLI Change: Generate Commit Message 失敗 — ${detail}`
                );
            }
            return;
        } finally {
            this.busy = false;
        }

        if (this.isCurrent(requestRevision, selected.path)) {
            await this.promptAndCommit(this.commitDraft);
        }
    }

    dispose(): void {
        this.revision += 1;
        this.selected = undefined;
        this.clearTree();
        this.treeEmitter.dispose();
        this.messageEmitter.dispose();
        void vscode.commands.executeCommand(
            "setContext",
            HAS_STAGED_CHANGES_CONTEXT_KEY,
            false
        );
    }

    private async loadSelected(): Promise<void> {
        const selected = this.selected;
        if (!selected) {
            return;
        }

        const revision = ++this.revision;
        this.clearTree();
        // 在 git 操作完成前設定 loading message，避免 VS Code 在「空 tree + 無 message」
        // 時顯示 loading spinner。
        this.setMessage(`正在讀取 ${selected.label}…`);
        this.updateStagedContext();

        try {
            if (!(await this.repository.isRepository(selected.path))) {
                if (this.isCurrent(revision, selected.path)) {
                    this.setMessage(
                        `${selected.label}：這個路徑不是 Git repository。`
                    );
                    this.updateStagedContext();
                }
                return;
            }

            const changes = await this.repository.readChanges(selected.path);
            if (!this.isCurrent(revision, selected.path)) {
                return;
            }

            this.changes = changes;
            this.rebuildTree(selected.path);
            this.setMessage(
                changes.length === 0 ? "沒有未提交變更。" : undefined
            );
            this.updateStagedContext();
            this.fireTreeChange();
        } catch (error: unknown) {
            if (!this.isCurrent(revision, selected.path)) {
                return;
            }
            const detail = describeError(error);
            this.log(`cliLauncher changes: refresh failed — ${detail}`);
            this.setMessage(`無法讀取 repository changes：${detail}`);
            this.updateStagedContext();
            this.fireTreeChange();
        }
    }

    private rebuildTree(repoPath: string): void {
        this.roots = [];
        this.items.clear();
        this.children.clear();
        this.nextNodeID = 0;

        for (const group of CHANGE_GROUPS) {
            const changes = this.changes.filter(
                (change) => change.group === group
            );
            if (changes.length === 0) {
                continue;
            }

            const groupItem = this.createItem(
                "group",
                group,
                changes,
                GROUP_TITLES[group],
                vscode.TreeItemCollapsibleState.Expanded
            );
            groupItem.description = String(changes.length);
            const branch = createBranch();
            for (const change of changes) {
                insertChange(branch, change);
            }
            const children = this.buildBranchChildren(
                repoPath,
                group,
                branch,
                []
            );
            this.children.set(groupItem.scmNodeID, children);
            this.roots.push(groupItem);
        }
    }

    private buildBranchChildren(
        repoPath: string,
        group: GitChangeGroup,
        branch: FolderBranch,
        parentSegments: readonly string[]
    ): SCMTreeItem[] {
        const folders = [...branch.folders.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, initialBranch]) => {
                const labelSegments = [name];
                const pathSegments = [...parentSegments, name];
                let folderBranch = initialBranch;

                while (
                    folderBranch.changes.length === 0 &&
                    folderBranch.folders.size === 1
                ) {
                    const [nextName, nextBranch] = [
                        ...folderBranch.folders.entries(),
                    ][0];
                    labelSegments.push(nextName);
                    pathSegments.push(nextName);
                    folderBranch = nextBranch;
                }

                const descendants = this.collectChanges(folderBranch);
                const item = this.createItem(
                    "folder",
                    group,
                    descendants,
                    labelSegments.join("/"),
                    vscode.TreeItemCollapsibleState.Expanded
                );
                item.resourceUri = vscode.Uri.file(
                    resolveRepositoryPath(repoPath, pathSegments.join("/"))
                );
                this.children.set(
                    item.scmNodeID,
                    this.buildBranchChildren(
                        repoPath,
                        group,
                        folderBranch,
                        pathSegments
                    )
                );
                return item;
            });

        const files = branch.changes
            .map(({ change }) => change)
            .sort((left, right) => left.path.localeCompare(right.path))
            .map((change) => {
                const item = this.createItem(
                    "change",
                    group,
                    [change],
                    path.posix.basename(change.path),
                    vscode.TreeItemCollapsibleState.None
                );
                item.description = change.marker;
                item.tooltip = `${MARKER_LABELS[change.marker]}: ${displayPath(change)}`;
                item.resourceUri = vscode.Uri.file(
                    resolveRepositoryPath(repoPath, change.path)
                );
                item.command = {
                    command: "superset.cliLauncherOpenChange",
                    title: "Open Changes",
                    arguments: [item],
                };
                return item;
            });

        return [...folders, ...files];
    }

    private collectChanges(branch: FolderBranch): GitChange[] {
        const changes = branch.changes.map(({ change }) => change);
        for (const child of branch.folders.values()) {
            changes.push(...this.collectChanges(child));
        }
        return changes.sort((left, right) => left.path.localeCompare(right.path));
    }

    private createItem(
        kind: TreeNodeKind,
        group: GitChangeGroup,
        changes: readonly GitChange[],
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ): SCMTreeItem {
        const item = new SCMTreeItem(
            `${this.revision}:${this.nextNodeID++}`,
            kind,
            group,
            changes,
            label,
            collapsibleState
        );
        this.items.set(item.scmNodeID, item);
        return item;
    }

    private resolveNode(target: unknown): SCMTreeItem | undefined {
        const id = toNodeID(target);
        return id ? this.items.get(id) : undefined;
    }

    private async promptAndCommit(initialValue: string): Promise<void> {
        const selected = this.selected;
        const requestRevision = this.revision;
        if (this.busy || !selected || !this.hasStagedChanges()) {
            return;
        }

        const message = await vscode.window.showInputBox({
            title: "Commit Staged Changes",
            prompt: "Commits staged changes only.",
            placeHolder: "Commit message",
            value: initialValue,
            ignoreFocusOut: true,
            validateInput: (value) =>
                value.trim() === "" ? "Commit message is required." : undefined,
        });
        if (!this.isCurrent(requestRevision, selected.path)) {
            return;
        }
        if (message === undefined) {
            this.commitDraft = initialValue;
            return;
        }

        const trimmed = message.trim();
        if (trimmed === "") {
            return;
        }
        this.commitDraft = trimmed;
        this.busy = true;
        try {
            await this.repository.commitStaged(selected.path, trimmed);
            this.commitDraft = "";
            if (this.selected?.path === selected.path) {
                await this.loadSelected();
            }
            await this.notifyRepositoryChanged();
        } catch (error: unknown) {
            const detail = describeError(error);
            this.log(`cliLauncher changes: commit failed — ${detail}`);
            if (this.selected?.path === selected.path) {
                await this.loadSelected();
            }
            await vscode.window.showErrorMessage(
                `CLI Change: commit 失敗 — ${detail}`
            );
        } finally {
            this.busy = false;
        }
    }

    private hasStagedChanges(): boolean {
        return this.changes.some((change) => change.group === "staged");
    }

    private isCurrent(revision: number, repoPath: string): boolean {
        return revision === this.revision && this.selected?.path === repoPath;
    }

    private setMessage(message: string | undefined): void {
        if (this._message === message) {
            return;
        }
        this._message = message;
        this.messageEmitter.fire(message);
    }

    private clearTree(): void {
        this.changes = [];
        this.roots = [];
        this.items.clear();
        this.children.clear();
        this.fireTreeChange();
    }

    private fireTreeChange(): void {
        this.treeEmitter.fire(undefined);
    }

    private updateStagedContext(): void {
        void vscode.commands.executeCommand(
            "setContext",
            HAS_STAGED_CHANGES_CONTEXT_KEY,
            this.hasStagedChanges()
        );
    }

    private async notifyRepositoryChanged(): Promise<void> {
        try {
            await this.onRepositoryChanged();
        } catch (error: unknown) {
            this.log(
                `cliLauncher changes: path refresh failed — ${describeError(error)}`
            );
        }
    }

    private async restoreChangeView(): Promise<void> {
        try {
            await vscode.commands.executeCommand("workbench.view.extension.cli");
            await vscode.commands.executeCommand(`${CHANGE_VIEW_ID}.focus`);
        } catch (error: unknown) {
            this.log(
                `cliLauncher changes: restore Change view failed — ${describeError(error)}`
            );
        }
    }
}
