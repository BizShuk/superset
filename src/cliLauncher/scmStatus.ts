// CLI Change View 的 pure Git status parser。
//
// 輸入固定是 `git status --porcelain=v1 -z`：NUL delimiter 讓檔名可安全包含
// newline，rename / copy record 則在 current path 後多一個 original path field。

export type GitChangeMarker = "U" | "A" | "!" | "D";
export type GitChangeGroup = "staged" | "unstaged" | "untracked";

export interface GitChange {
    readonly group: GitChangeGroup;
    readonly marker: GitChangeMarker;
    readonly path: string;
    readonly originalPath?: string;
    readonly indexStatus: string;
    readonly workTreeStatus: string;
}

const CONFLICT_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function markerForStage(status: string): GitChangeMarker {
    if (status === "A") {
        return "A";
    }
    if (status === "D") {
        return "D";
    }
    return "U";
}

function createChange(
    group: GitChangeGroup,
    marker: GitChangeMarker,
    path: string,
    originalPath: string | undefined,
    indexStatus: string,
    workTreeStatus: string
): GitChange {
    return {
        group,
        marker,
        path,
        ...(originalPath ? { originalPath } : {}),
        indexStatus,
        workTreeStatus,
    };
}

/** 解析 NUL-delimited porcelain v1 output，維持 Git 回傳順序。 */
export function parseGitStatus(output: string): GitChange[] {
    const fields = output.split("\0");
    const changes: GitChange[] = [];

    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        if (field.length < 4 || field[2] !== " ") {
            continue;
        }

        const status = field.slice(0, 2);
        if (status === "!!") {
            continue;
        }

        const changePath = field.slice(3);
        if (changePath === "") {
            continue;
        }

        const renamedOrCopied = /[RC]/.test(status);
        const originalPath = renamedOrCopied ? fields[index + 1] : undefined;
        if (renamedOrCopied) {
            index += 1;
        }

        const indexStatus = status[0];
        const workTreeStatus = status[1];

        if (status === "??") {
            changes.push(
                createChange(
                    "untracked",
                    "A",
                    changePath,
                    originalPath,
                    indexStatus,
                    workTreeStatus
                )
            );
            continue;
        }

        if (CONFLICT_STATUSES.has(status)) {
            changes.push(
                createChange(
                    "unstaged",
                    "!",
                    changePath,
                    originalPath,
                    indexStatus,
                    workTreeStatus
                )
            );
            continue;
        }

        if (indexStatus !== " ") {
            changes.push(
                createChange(
                    "staged",
                    markerForStage(indexStatus),
                    changePath,
                    originalPath,
                    indexStatus,
                    workTreeStatus
                )
            );
        }
        if (workTreeStatus !== " ") {
            changes.push(
                createChange(
                    "unstaged",
                    markerForStage(workTreeStatus),
                    changePath,
                    originalPath,
                    indexStatus,
                    workTreeStatus
                )
            );
        }
    }

    return changes;
}
