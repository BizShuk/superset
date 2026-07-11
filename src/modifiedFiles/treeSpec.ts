import type { FileStatus, TreeItemSpec, TreeNode } from "./types";

const STATUS_ICON: Readonly<Record<FileStatus, string>> = {
    M: "edit",
    A: "add",
    D: "trash",
    R: "diff",
    "?": "question",
};

/**
 * Map `TreeNode` to a pure-data `TreeItemSpec`. The spec is consumed by
 * `treeProvider` which is responsible for converting it to `vscode.TreeItem`
 * and resolving relative paths to absolute URIs.
 *
 * Folder `command` is intentionally omitted — clicking a folder only
 * toggles expansion via the chevron.
 */
export function buildTreeItem(node: TreeNode): TreeItemSpec {
    if (node.kind === "file") {
        const description =
            node.status === "R" && node.oldPath
                ? `${node.oldPath} → ${node.label}`
                : undefined;
        const oldPathSuffix = node.oldPath ? `\nfrom: ${node.oldPath}` : "";
        return {
            label: node.label,
            iconId: STATUS_ICON[node.status],
            ...(description !== undefined ? { description } : {}),
            tooltip: `${node.path}\nstatus: ${node.status}${oldPathSuffix}`,
            collapsibleState: "none",
            contextValue: "modifiedFile",
            command: {
                command: "vscode.open",
                // Args are repo-relative path; treeProvider will resolve to absolute URI
                args: [node.path],
            },
        };
    }

    // folder
    const summaryParts: string[] = [];
    const order: FileStatus[] = ["M", "A", "D", "R", "?"];
    for (const s of order) {
        const count = node.statusSummary.get(s);
        if (count && count > 0) summaryParts.push(`${s} ${count}`);
    }
    let total = 0;
    for (const v of node.statusSummary.values()) total += v;
    const description = summaryParts.length > 0
        ? summaryParts.join(" · ")
        : `${total} files`;

    return {
        label: node.label,
        iconId: "folder",
        description,
        tooltip: `${node.path} — ${total} modified files`,
        collapsibleState: "collapsed",
        contextValue: "modifiedFolder",
    };
}