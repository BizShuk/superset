// CLI Change View 的 stage / unstage / discard orchestration。

import { resolveRepositoryPath } from "./scmPath";
import type { GitSCMRepository } from "./scmRepository";
import type { GitChange, GitChangeGroup } from "./scmStatus";

export type TrashFile = (absolutePath: string) => Promise<void>;

function requireGroup(changes: readonly GitChange[]): GitChangeGroup {
    const group = changes[0]?.group;
    if (!group) {
        throw new Error("At least one change is required.");
    }
    if (changes.some((change) => change.group !== group)) {
        throw new Error(
            "SCM actions require changes from the same change group."
        );
    }
    return group;
}

function changePaths(changes: readonly GitChange[]): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const change of changes) {
        for (const candidate of [change.path, change.originalPath]) {
            if (candidate && !seen.has(candidate)) {
                seen.add(candidate);
                paths.push(candidate);
            }
        }
    }
    return paths;
}

export class SCMActionService {
    constructor(
        private readonly repository: GitSCMRepository,
        private readonly trashFile: TrashFile
    ) {}

    async stage(repoPath: string, changes: readonly GitChange[]): Promise<void> {
        const group = requireGroup(changes);
        if (group === "staged") {
            throw new Error("Staged changes cannot be staged again.");
        }
        await this.repository.stage(repoPath, changePaths(changes));
    }

    async unstage(
        repoPath: string,
        changes: readonly GitChange[]
    ): Promise<void> {
        const group = requireGroup(changes);
        if (group !== "staged") {
            throw new Error(`${group} changes cannot be unstaged.`);
        }
        await this.repository.unstage(repoPath, changePaths(changes));
    }

    async discard(
        repoPath: string,
        changes: readonly GitChange[]
    ): Promise<void> {
        const group = requireGroup(changes);

        if (group === "untracked") {
            await this.trashChanges(repoPath, changes);
            return;
        }

        if (group === "unstaged") {
            const conflicts = changes.filter((change) => change.marker === "!");
            const ordinary = changes.filter((change) => change.marker !== "!");
            if (ordinary.length > 0) {
                await this.repository.discardWorktreeChanges(
                    repoPath,
                    changePaths(ordinary)
                );
            }
            if (conflicts.length > 0) {
                await this.repository.discardTrackedChanges(
                    repoPath,
                    changePaths(conflicts)
                );
            }
            return;
        }

        const newlyAdded: GitChange[] = [];
        const tracked: GitChange[] = [];
        for (const change of changes) {
            if (
                change.marker === "A" &&
                !(await this.repository.isTrackedInHead(repoPath, change.path))
            ) {
                newlyAdded.push(change);
            } else {
                tracked.push(change);
            }
        }

        if (tracked.length > 0) {
            await this.repository.discardTrackedChanges(
                repoPath,
                changePaths(tracked)
            );
        }
        if (newlyAdded.length > 0) {
            await this.repository.unstage(repoPath, changePaths(newlyAdded));
            await this.trashChanges(repoPath, newlyAdded);
        }
    }

    private async trashChanges(
        repoPath: string,
        changes: readonly GitChange[]
    ): Promise<void> {
        for (const change of changes) {
            await this.trashFile(resolveRepositoryPath(repoPath, change.path));
        }
    }
}
