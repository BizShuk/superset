// CLI SCM repository-relative path boundary。

import * as path from "node:path";

export function resolveRepositoryPath(
    repoPath: string,
    relativePath: string
): string {
    if (
        relativePath === "" ||
        relativePath.includes("\0") ||
        path.isAbsolute(relativePath)
    ) {
        throw new Error(
            `Change path is outside the selected repository: ${relativePath}`
        );
    }

    const repositoryRoot = path.resolve(repoPath);
    const resolved = path.resolve(repositoryRoot, relativePath);
    const relation = path.relative(repositoryRoot, resolved);
    if (
        relation === "" ||
        relation === ".." ||
        relation.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relation)
    ) {
        throw new Error(
            `Change path is outside the selected repository: ${relativePath}`
        );
    }
    return resolved;
}
