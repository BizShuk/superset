# Explorer Copy GitHub URL Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Goal: 在 Explorer 檔案右鍵加入 `Copy GitHub URL`，將固定使用 `master` branch 的 GitHub URL 寫入 clipboard。

Architecture: 在 `src/git/githubUrl.ts` 實作無 `vscode` import 的 remote/path 純函式；既有 `src/git/index.ts` 透過 VS Code Git extension API 取得 repository 與 remotes，並負責 clipboard 與通知。`package.json` 使用 stable `explorer/context` contribution，不新增 proposed API。

Tech Stack: TypeScript 5、VS Code Extension API、VS Code built-in Git API、Vitest 4。

## Global Constraints

- URL 固定為 `https://github.com/<owner>/<repo>/blob/master/<relative-path>`。
- 不呼叫 GitHub API，不檢查 `master` 或檔案是否存在於 GitHub。
- 優先使用 GitHub `origin` remote，否則使用第一個 GitHub remote。
- 選單使用 `explorer/context` 與 `6_copypath@100`。
- 保留工作區既有未提交的 SCM Graph proposed API 變更。
- 版本從目前工作樹的 `0.13.3` patch bump 至 `0.13.4`。

---

## File Structure

- Create `src/git/githubUrl.ts`: remote normalization、remote selection、repository-relative URL builder。
- Create `test/githubUrl.test.ts`: 純函式單元測試。
- Create `test/gitCopyGithubUrlCommand.test.ts`: Git plugin command orchestration 測試。
- Modify `src/git/index.ts`: 註冊 `superset.copyGitHubUrl` 並連接 VS Code Git API、clipboard、notifications。
- Modify `test/packageManifest.test.ts`: command 與 Explorer menu contribution 契約。
- Modify `package.json`: command、menu、版本。
- Modify `package-lock.json`: 同步 root package 版本。
- Modify `README.md`: 使用方式與 command 一覽。
- Modify `CLAUDE.md`: Git feature 架構與資料流。

---

## Task 1: GitHub URL Pure Helpers

Files:

- Create: `src/git/githubUrl.ts`
- Create: `test/githubUrl.test.ts`

Interfaces:

- Produces: `parseGitHubRemote(remoteUrl: string): GitHubRepository | null`
- Produces: `selectGitHubRemote(remotes: readonly GitRemoteLike[]): GitHubRepository | null`
- Produces: `buildGitHubFileUrl(repository: GitHubRepository, repoRoot: string, filePath: string): string | null`

- [ ] Step 1: Write failing remote parser and selector tests

```ts
import { describe, expect, it } from "vitest";
import {
    buildGitHubFileUrl,
    parseGitHubRemote,
    selectGitHubRemote,
} from "../src/git/githubUrl";

describe("parseGitHubRemote", () => {
    it.each([
        "git@github.com:BizShuk/superset.git",
        "ssh://git@github.com/BizShuk/superset.git",
        "https://github.com/BizShuk/superset.git",
        "http://github.com/BizShuk/superset.git",
    ])("normalizes %s", remoteUrl => {
        expect(parseGitHubRemote(remoteUrl)).toEqual({
            owner: "BizShuk",
            repository: "superset",
        });
    });

    it("rejects non-GitHub remotes", () => {
        expect(parseGitHubRemote("git@gitlab.com:BizShuk/superset.git")).toBeNull();
    });
});

describe("selectGitHubRemote", () => {
    it("prefers GitHub origin over earlier GitHub remotes", () => {
        expect(selectGitHubRemote([
            { name: "upstream", fetchUrl: "https://github.com/up/project.git" },
            { name: "origin", fetchUrl: "git@github.com:me/fork.git" },
        ])).toEqual({ owner: "me", repository: "fork" });
    });

    it("falls back to the first GitHub remote", () => {
        expect(selectGitHubRemote([
            { name: "origin", fetchUrl: "git@gitlab.com:me/project.git" },
            { name: "github", pushUrl: "https://github.com/me/project.git" },
        ])).toEqual({ owner: "me", repository: "project" });
    });
});
```

- [ ] Step 2: Run `npx vitest run test/githubUrl.test.ts`

Expected: FAIL because `src/git/githubUrl.ts` does not exist.

- [ ] Step 3: Implement remote parsing and selection

```ts
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

export function parseGitHubRemote(remoteUrl: string): GitHubRepository | null {
    const scp = /^git@github\.com:([^/]+)\/([^/]+?)\/?$/i.exec(remoteUrl.trim());
    if (scp) return toRepository(scp[1], scp[2]);

    try {
        const url = new URL(remoteUrl.trim());
        if (url.hostname.toLowerCase() !== "github.com") return null;
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length !== 2) return null;
        return toRepository(parts[0], parts[1]);
    } catch {
        return null;
    }
}

export function selectGitHubRemote(
    remotes: readonly GitRemoteLike[]
): GitHubRepository | null {
    const candidates = remotes.flatMap(remote => {
        const parsed = [remote.fetchUrl, remote.pushUrl]
            .filter((value): value is string => typeof value === "string")
            .map(parseGitHubRemote)
            .find((value): value is GitHubRepository => value !== null);
        return parsed ? [{ name: remote.name, repository: parsed }] : [];
    });
    return candidates.find(candidate => candidate.name === "origin")?.repository
        ?? candidates[0]?.repository
        ?? null;
}

function toRepository(owner: string, repository: string): GitHubRepository | null {
    const cleanRepository = repository.replace(/\.git$/i, "");
    return owner && cleanRepository ? { owner, repository: cleanRepository } : null;
}
```

- [ ] Step 4: Run `npx vitest run test/githubUrl.test.ts`

Expected: parser and selector tests PASS.

- [ ] Step 5: Add failing URL builder tests

```ts
describe("buildGitHubFileUrl", () => {
    const repository = { owner: "BizShuk", repository: "superset" };

    it("builds a master URL and encodes each relative path segment", () => {
        expect(buildGitHubFileUrl(
            repository,
            "/repo",
            "/repo/docs/中文 note.md"
        )).toBe(
            "https://github.com/BizShuk/superset/blob/master/docs/%E4%B8%AD%E6%96%87%20note.md"
        );
    });

    it("rejects a path outside the repository", () => {
        expect(buildGitHubFileUrl(repository, "/repo", "/other/file.ts")).toBeNull();
    });

    it("rejects the repository root because the command targets files", () => {
        expect(buildGitHubFileUrl(repository, "/repo", "/repo")).toBeNull();
    });
});
```

- [ ] Step 6: Run `npx vitest run test/githubUrl.test.ts`

Expected: FAIL because `buildGitHubFileUrl` has not been exported.

- [ ] Step 7: Implement URL building

```ts
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
    ) return null;

    const encodedPath = relativePath
        .split(path.sep)
        .map(encodeURIComponent)
        .join("/");
    return `https://github.com/${encodeURIComponent(repository.owner)}` +
        `/${encodeURIComponent(repository.repository)}/blob/master/${encodedPath}`;
}
```

- [ ] Step 8: Run `npx vitest run test/githubUrl.test.ts`

Expected: all helper tests PASS.

---

## Task 2: Explorer Command Orchestration

Files:

- Modify: `src/git/index.ts`
- Create: `test/gitCopyGithubUrlCommand.test.ts`

Interfaces:

- Consumes: `selectGitHubRemote(...)` and `buildGitHubFileUrl(...)` from Task 1.
- Produces: registered command `superset.copyGitHubUrl`.

- [ ] Step 1: Write a failing command test with a minimal `vscode` mock

The test registers the Git feature, invokes the captured command with
`{ scheme: "file", fsPath: "/repo/src/a.ts" }`, and asserts:

```ts
expect(writeText).toHaveBeenCalledWith(
    "https://github.com/BizShuk/superset/blob/master/src/a.ts"
);
expect(showInformationMessage).toHaveBeenCalledWith(
    "Superset: GitHub URL copied"
);
```

Add separate cases asserting that missing URI and missing GitHub remote call
`showErrorMessage` and never call `writeText`.

- [ ] Step 2: Run `npx vitest run test/gitCopyGithubUrlCommand.test.ts`

Expected: FAIL because `superset.copyGitHubUrl` is not registered.

- [ ] Step 3: Add Git API duck types and the command handler to `src/git/index.ts`

```ts
interface GitRemoteApi {
    readonly name: string;
    readonly fetchUrl?: string;
    readonly pushUrl?: string;
}

interface GitRepositoryApi {
    readonly rootUri: vscode.Uri;
    readonly state: { readonly remotes: readonly GitRemoteApi[] };
}

interface GitApi {
    getRepository(uri: vscode.Uri): GitRepositoryApi | null;
}

interface GitExtensionExports {
    getAPI(version: 1): GitApi;
}

async function getGitApi(): Promise<GitApi | null> {
    const extension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
    if (!extension) return null;
    const exports = extension.isActive ? extension.exports : await extension.activate();
    return exports.getAPI(1);
}

async function copyGitHubUrl(uri: vscode.Uri | undefined, ctx: FeatureContext): Promise<void> {
    if (!uri || uri.scheme !== "file") {
        await vscode.window.showErrorMessage(
            "Superset: 請從 Explorer 的本機檔案右鍵執行 Copy GitHub URL"
        );
        return;
    }

    const api = await getGitApi();
    const repository = api?.getRepository(uri) ?? null;
    if (!repository) {
        await vscode.window.showErrorMessage("Superset: 找不到檔案所屬的 Git repository");
        return;
    }

    const remote = selectGitHubRemote(repository.state.remotes);
    if (!remote) {
        await vscode.window.showErrorMessage("Superset: repository 沒有 GitHub remote");
        return;
    }

    const url = buildGitHubFileUrl(remote, repository.rootUri.fsPath, uri.fsPath);
    if (!url) {
        await vscode.window.showErrorMessage("Superset: 無法建立 repository-relative GitHub URL");
        return;
    }

    await vscode.env.clipboard.writeText(url);
    await vscode.window.showInformationMessage("Superset: GitHub URL copied");
    ctx.shared.log(`git: copied GitHub URL ${url}`);
}
```

Register it beside the reset commands:

```ts
vscode.commands.registerCommand(
    "superset.copyGitHubUrl",
    (uri: vscode.Uri | undefined) => void copyGitHubUrl(uri, ctx)
)
```

- [ ] Step 4: Run the selected Git tests

Run: `npx vitest run test/githubUrl.test.ts test/gitCopyGithubUrlCommand.test.ts test/gitReset.test.ts test/gitPlugin.test.ts`

Expected: all selected tests PASS.

---

## Task 3: Manifest Contribution and Version

Files:

- Modify: `test/packageManifest.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

Interfaces:

- Produces: Explorer context menu invoking `superset.copyGitHubUrl`.

- [ ] Step 1: Add a failing manifest contract test

```ts
it("adds Copy GitHub URL to the Explorer copy-path group", () => {
    expect(manifest.contributes.commands).toContainEqual({
        command: "superset.copyGitHubUrl",
        title: "Copy GitHub URL",
        icon: "$(github)",
    });
    expect(manifest.contributes.menus["explorer/context"]).toContainEqual({
        command: "superset.copyGitHubUrl",
        when: "resourceScheme == file && !explorerResourceIsRoot",
        group: "6_copypath@100",
    });
});
```

Extend the local manifest type with a `commands` array.

- [ ] Step 2: Run `npx vitest run test/packageManifest.test.ts`

Expected: FAIL because the command and menu item are absent.

- [ ] Step 3: Add the command and menu contribution

Add to `contributes.commands`:

```json
{
    "command": "superset.copyGitHubUrl",
    "title": "Copy GitHub URL",
    "icon": "$(github)"
}
```

Add to `contributes.menus.explorer/context`:

```json
{
    "command": "superset.copyGitHubUrl",
    "when": "resourceScheme == file && !explorerResourceIsRoot",
    "group": "6_copypath@100"
}
```

- [ ] Step 4: Patch-bump `package.json` and both root version fields in `package-lock.json` from `0.13.3` to `0.13.4`.

- [ ] Step 5: Run `npx vitest run test/packageManifest.test.ts`

Expected: all manifest contract tests PASS.

---

## Task 4: Documentation and Cross-file Consistency

Files:

- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] Step 1: Update user-facing documentation

Add a feature row and usage section stating:

```text
Explorer 檔案右鍵 → Copy GitHub URL
https://github.com/<owner>/<repo>/blob/master/<relative-path>
```

State explicitly that the extension does not check whether `master` or the file
exists on GitHub.

- [ ] Step 2: Update technical documentation

Extend the `src/git/` architecture entry with `githubUrl.ts` and document:

```tree
Explorer Uri
└── vscode.git API repository/remotes
    └── GitHub origin preferred
        └── pure URL builder
            └── clipboard
```

- [ ] Step 3: Run the consistency review

Run:

```bash
rg -n "Copy GitHub URL|copyGitHubUrl|blob/master|src/git/|0\.13\.[34]" README.md CLAUDE.md package.json package-lock.json src test plans
```

Expected: command id, copy, branch, versions, and file ownership agree across
code, manifest, tests, design, and docs; report any genuine contradiction.

---

## Task 5: Full Verification

Files:

- Verify only; no planned source changes.

- [ ] Step 1: Run `git diff --check`

Expected: exit 0 with no whitespace errors.

- [ ] Step 2: Run `npm test`

Expected: all Vitest files and tests PASS with zero failures.

- [ ] Step 3: Run `npm run build`

Expected: TypeScript compilation, VSIX packaging, and `scripts/verify-vsix.sh` all exit 0.

- [ ] Step 4: Inspect final scope

Run:

```bash
git status --short
git diff -- src/git/githubUrl.ts src/git/index.ts test/githubUrl.test.ts test/gitCopyGithubUrlCommand.test.ts test/packageManifest.test.ts package.json package-lock.json README.md CLAUDE.md
```

Expected: only Copy GitHub URL changes plus the preserved pre-existing Graph
changes appear; no unrelated file is reverted or overwritten.
