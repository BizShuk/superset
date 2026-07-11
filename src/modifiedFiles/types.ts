export type FileStatus = "M" | "A" | "D" | "R" | "?";

/**
 * Single modified file as parsed from `git status --porcelain`.
 * `path` is repo-relative (POSIX separators).
 * `oldPath` only set when status === "R" (rename/copy old name).
 */
export interface ModifiedFile {
    readonly path: string;
    readonly status: FileStatus;
    readonly oldPath?: string;
}

/**
 * Tree node produced by `treeBuilder.build()`. Folder nodes are synthetic
 * (created only when they have modified descendants); file nodes correspond
 * directly to `ModifiedFile` entries.
 *
 * `statusSummary` on folder nodes is a Map<FileStatus, count> covering all
 * descendants (recursive). Pre-computed by `treeBuilder` so `treeSpec` does
 * not need to walk the tree.
 */
export type TreeNode =
    | {
          readonly kind: "folder";
          readonly label: string;
          /** Repo-relative path (POSIX), e.g. "src/plugins". */
          readonly path: string;
          readonly children: readonly TreeNode[];
          readonly statusSummary: ReadonlyMap<FileStatus, number>;
      }
    | {
          readonly kind: "file";
          readonly label: string;
          readonly path: string;
          readonly status: FileStatus;
          readonly oldPath?: string;
      };

/**
 * Pure-data shape that `treeSpec` returns and `treeProvider` consumes.
 * Lets tests assert against the spec without constructing `vscode.TreeItem`.
 *
 * `command.args` carries the repo-relative `path` (string). `treeProvider`
 * is responsible for joining with `repoRoot` and wrapping in `vscode.Uri.file`
 * at construction time — keeping `treeSpec` free of I/O concerns.
 */
export interface TreeItemSpec {
    readonly label: string;
    /** `vscode.ThemeIcon` id (e.g. "edit", "folder"). */
    readonly iconId: string;
    readonly description?: string;
    readonly tooltip: string;
    readonly collapsibleState: "none" | "collapsed" | "expanded";
    readonly contextValue: "modifiedFile" | "modifiedFolder";
    readonly command?: { command: string; args: unknown[] };
}