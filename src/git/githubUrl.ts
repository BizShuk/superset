import path from "node:path";

export interface GitHubRepository {
    readonly owner: string;
    readonly repository: string;
}

export interface GitRemoteLike {
    readonly name: string;
    readonly fetchUrl?: string;
    readonly pushUrl?: string;
}

/** Normalize a supported GitHub remote URL into its owner/repository pair. */
export function parseGitHubRemote(
    remoteUrl: string
): GitHubRepository | null {
    const trimmed = remoteUrl.trim();
    const scp = /^git@github\.com:([^/]+)\/([^/]+?)\/?$/i.exec(trimmed);
    if (scp) return toRepository(scp[1], scp[2]);

    try {
        const url = new URL(trimmed);
        if (url.hostname.toLowerCase() !== "github.com") return null;

        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length !== 2) return null;
        return toRepository(parts[0], parts[1]);
    } catch {
        return null;
    }
}

/** Prefer a GitHub origin, then fall back to the first GitHub remote. */
export function selectGitHubRemote(
    remotes: readonly GitRemoteLike[]
): GitHubRepository | null {
    const candidates = remotes.flatMap(remote => {
        const repository = [remote.fetchUrl, remote.pushUrl]
            .filter((value): value is string => typeof value === "string")
            .map(parseGitHubRemote)
            .find((value): value is GitHubRepository => value !== null);

        return repository ? [{ name: remote.name, repository }] : [];
    });

    return (
        candidates.find(candidate => candidate.name === "origin")
            ?.repository ??
        candidates[0]?.repository ??
        null
    );
}

/** Build a fixed-master GitHub file URL without making a network request. */
export function buildGitHubFileUrl(
    repository: GitHubRepository,
    repoRoot: string,
    filePath: string
): string | null {
    const relativePath = path.relative(repoRoot, filePath);
    if (
        relativePath === "" ||
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
    ) {
        return null;
    }

    const encodedPath = relativePath
        .split(path.sep)
        .map(encodeURIComponent)
        .join("/");
    return (
        `https://github.com/${encodeURIComponent(repository.owner)}` +
        `/${encodeURIComponent(repository.repository)}` +
        `/blob/master/${encodedPath}`
    );
}

function toRepository(
    owner: string,
    repository: string
): GitHubRepository | null {
    const cleanRepository = repository.replace(/\.git$/i, "");
    return owner && cleanRepository
        ? { owner, repository: cleanRepository }
        : null;
}
