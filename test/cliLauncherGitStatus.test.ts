// `git diff --numstat` 的解析與 description 格式化。純字串進出,
// 不 spawn 任何行程。

import { describe, it, expect } from "vitest";
import {
    formatGitFolderDescription,
    formatGitFolderStatus,
    parseAheadBehind,
    parseNumstat,
    type GitFolderStatus,
} from "../src/cliLauncher/gitStatus";

/** 測試只在意其中一兩個欄位;其餘補成「乾淨且與遠端同步」。 */
function status(partial: Partial<GitFolderStatus>): GitFolderStatus {
    return {
        branch: "master",
        added: 0,
        removed: 0,
        ahead: 0,
        behind: 0,
        ...partial,
    };
}

describe("parseNumstat", () => {
    it("returns zeros for an empty diff", () => {
        expect(parseNumstat("")).toEqual({ added: 0, removed: 0 });
    });

    it("sums added and removed lines across files", () => {
        const output = [
            "12\t3\tsrc/tree.ts",
            "0\t7\tsrc/gone.ts",
            "5\t0\tdocs/new.md",
            "",
        ].join("\n");

        expect(parseNumstat(output)).toEqual({ added: 17, removed: 10 });
    });

    it("skips binary files reported as dashes", () => {
        const output = ["-\t-\tpkg/logo.png", "4\t1\tREADME.md"].join("\n");

        expect(parseNumstat(output)).toEqual({ added: 4, removed: 1 });
    });

    it("ignores malformed lines", () => {
        expect(parseNumstat("garbage\n\n3\t2\tsrc/a.ts\n")).toEqual({
            added: 3,
            removed: 2,
        });
    });
});

describe("parseAheadBehind", () => {
    it("reads left as behind and right as ahead", () => {
        expect(parseAheadBehind("2\t5\n")).toEqual({ ahead: 5, behind: 2 });
    });

    it("treats a missing upstream as no divergence", () => {
        expect(parseAheadBehind(undefined)).toEqual({ ahead: 0, behind: 0 });
        expect(parseAheadBehind("")).toEqual({ ahead: 0, behind: 0 });
        expect(parseAheadBehind("garbage")).toEqual({ ahead: 0, behind: 0 });
    });
});

describe("formatGitFolderStatus", () => {
    it("renders the branch with its line deltas", () => {
        expect(
            formatGitFolderStatus(
                status({ branch: "master", added: 12, removed: 3 })
            )
        ).toBe("master(+12,-3)");
    });

    it("keeps zeros so the branch stays visible on a clean repository", () => {
        expect(formatGitFolderStatus(status({ branch: "master" }))).toBe(
            "master(+0,-0)"
        );
    });

    it("appends unpushed and unpulled commit counts next to the branch", () => {
        expect(
            formatGitFolderStatus(
                status({ branch: "master", ahead: 3, behind: 1 })
            )
        ).toBe("master↑3↓1(+0,-0)");
    });

    it("omits the side that is in sync", () => {
        expect(formatGitFolderStatus(status({ ahead: 2 }))).toBe(
            "master↑2(+0,-0)"
        );
        expect(formatGitFolderStatus(status({ behind: 4 }))).toBe(
            "master↓4(+0,-0)"
        );
    });

    it("renders nothing when there is no git information", () => {
        expect(formatGitFolderStatus(undefined)).toBe("");
    });

    it("renders nothing when the branch could not be resolved", () => {
        expect(
            formatGitFolderStatus(status({ branch: "", added: 5, removed: 5 }))
        ).toBe("");
    });
});

describe("formatGitFolderDescription", () => {
    it("hides the default branch when there is nothing pending", () => {
        for (const branch of ["master", "main"]) {
            expect(formatGitFolderDescription(status({ branch }))).toBe("");
        }
    });

    it("keeps the default branch as soon as there are changes", () => {
        expect(
            formatGitFolderDescription(status({ branch: "master", added: 1 }))
        ).toBe("master(+1,-0)");
    });

    it("keeps a clean default branch that has commits to push or pull", () => {
        expect(formatGitFolderDescription(status({ ahead: 1 }))).toBe(
            "master↑1(+0,-0)"
        );
        expect(formatGitFolderDescription(status({ behind: 2 }))).toBe(
            "master↓2(+0,-0)"
        );
    });

    it("keeps a clean non-default branch — which branch you are on is the point", () => {
        expect(formatGitFolderDescription(status({ branch: "w-cli-git" }))).toBe(
            "w-cli-git(+0,-0)"
        );
    });

    it("renders nothing without git information", () => {
        expect(formatGitFolderDescription(undefined)).toBe("");
    });
});
