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
        expect(
            parseGitHubRemote("git@gitlab.com:BizShuk/superset.git")
        ).toBeNull();
    });
});

describe("selectGitHubRemote", () => {
    it("prefers GitHub origin over earlier GitHub remotes", () => {
        expect(
            selectGitHubRemote([
                {
                    name: "upstream",
                    fetchUrl: "https://github.com/up/project.git",
                },
                {
                    name: "origin",
                    fetchUrl: "git@github.com:me/fork.git",
                },
            ])
        ).toEqual({ owner: "me", repository: "fork" });
    });

    it("falls back to the first GitHub remote", () => {
        expect(
            selectGitHubRemote([
                {
                    name: "origin",
                    fetchUrl: "git@gitlab.com:me/project.git",
                },
                {
                    name: "github",
                    pushUrl: "https://github.com/me/project.git",
                },
            ])
        ).toEqual({ owner: "me", repository: "project" });
    });
});

describe("buildGitHubFileUrl", () => {
    const repository = {
        owner: "BizShuk",
        repository: "superset",
    };

    it("builds a master URL and encodes each relative path segment", () => {
        expect(
            buildGitHubFileUrl(
                repository,
                "/repo",
                "/repo/docs/中文 note.md"
            )
        ).toBe(
            "https://github.com/BizShuk/superset/blob/master/docs/" +
                "%E4%B8%AD%E6%96%87%20note.md"
        );
    });

    it("rejects a path outside the repository", () => {
        expect(
            buildGitHubFileUrl(repository, "/repo", "/other/file.ts")
        ).toBeNull();
    });

    it("rejects the repository root because the command targets files", () => {
        expect(
            buildGitHubFileUrl(repository, "/repo", "/repo")
        ).toBeNull();
    });
});
