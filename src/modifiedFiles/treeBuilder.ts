import type { FileStatus, ModifiedFile, TreeNode } from "./types";

export interface BuildOptions {
    readonly showUntracked: boolean;
}

/**
 * Convert flat list of `ModifiedFile` into a forest of `TreeNode`.
 * Folder nodes are synthetic — created only when they have modified descendants.
 *
 * @param files - flat list (typically from `gitStatusParser.parse`)
 * @param opts.showUntracked - if false, `?` files are filtered out
 * @returns top-level entries (mix of folders and files), sorted alphabetically
 */
export function build(
    files: readonly ModifiedFile[],
    opts: BuildOptions,
): readonly TreeNode[] {
    const filtered = opts.showUntracked ? files : files.filter(f => f.status !== "?");
    if (filtered.length === 0) return [];

    // Mutable working area; final cast to readonly in return.
    interface MutableFolder {
        kind: "folder";
        label: string;
        path: string;
        children: TreeNode[];
        statusSummary: Map<FileStatus, number>;
    }

    const folderIndex = new Map<string, MutableFolder>();
    const roots: MutableFolder[] = [];
    const topLevelFiles: TreeNode[] = [];

    const pathSep = (s: string) => s.replace(/\\/g, "/");
    const parts = (p: string) => pathSep(p).split("/");
    const dirname = (p: string): string => {
        const segs = parts(p);
        segs.pop();
        return segs.join("/");
    };
    const basename = (p: string): string => parts(p).pop() ?? p;

    const ensureFolder = (folderPath: string, label: string): MutableFolder => {
        const existing = folderIndex.get(folderPath);
        if (existing) return existing;
        const folder: MutableFolder = {
            kind: "folder",
            label,
            path: folderPath,
            children: [],
            statusSummary: new Map(),
        };
        folderIndex.set(folderPath, folder);
        const parentPath = dirname(folderPath);
        if (parentPath) {
            const parent = ensureFolder(parentPath, basename(parentPath));
            parent.children.push(folder);
        } else {
            roots.push(folder);
        }
        return folder;
    };

    for (const f of filtered) {
        const dir = dirname(f.path);
        const fileLabel = basename(f.path);
        const fileNode: TreeNode = {
            kind: "file",
            label: fileLabel,
            path: f.path,
            status: f.status,
            ...(f.oldPath !== undefined ? { oldPath: f.oldPath } : {}),
        };
        if (dir) {
            const folder = ensureFolder(dir, basename(dir));
            folder.children.push(fileNode);
        } else {
            topLevelFiles.push(fileNode);
        }
    }

    // Compute statusSummary recursively for folders
    const computeSummary = (folder: MutableFolder): void => {
        for (const child of folder.children) {
            if (child.kind === "file") {
                folder.statusSummary.set(
                    child.status,
                    (folder.statusSummary.get(child.status) ?? 0) + 1,
                );
            } else {
                computeSummary(child as MutableFolder);
                const sub = (child as MutableFolder).statusSummary;
                for (const [k, v] of sub) {
                    folder.statusSummary.set(k, (folder.statusSummary.get(k) ?? 0) + v);
                }
            }
        }
    };
    roots.forEach(computeSummary);

    // Sort children (alphabetical, no folder/file separation)
    const sortRecursive = (node: TreeNode): void => {
        if (node.kind !== "folder") return;
        // Safe cast: we built these arrays ourselves and only return them after
        // sorting. The readonly type is for downstream consumers.
        const children = node.children as TreeNode[];
        children.sort((a, b) => a.label.localeCompare(b.label));
        children.forEach(sortRecursive);
    };
    roots.forEach(sortRecursive);
    topLevelFiles.sort((a, b) => a.label.localeCompare(b.label));

    // Merge roots + top-level files, sort
    const forest: TreeNode[] = [...(roots as readonly TreeNode[]), ...topLevelFiles];
    forest.sort((a, b) => a.label.localeCompare(b.label));
    return forest;
}