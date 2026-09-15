// `git diff --numstat` 的解析與 description 格式化。純字串進出,
// 不 spawn 任何行程。

import { describe, it, expect } from "vitest";
import {
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
        hasUpstream: true,
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
        expect(parseAheadBehind("2\t5\n")).toEqual({
            ahead: 5,
            behind: 2,
            hasUpstream: true,
        });
    });

    it("reports an in-sync branch as a real zero", () => {
        expect(parseAheadBehind("0\t0\n")).toEqual({
            ahead: 0,
            behind: 0,
            hasUpstream: true,
        });
    });

    it("marks a missing upstream apart from an in-sync branch", () => {
        for (const output of [undefined, "", "garbage"]) {
            expect(parseAheadBehind(output)).toEqual({
                ahead: 0,
                behind: 0,
                hasUpstream: false,
            });
        }
    });
});

describe("formatGitFolderStatus", () => {
    it("always renders the divergence from the upstream", () => {
        expect(formatGitFolderStatus(status({ branch: "master" }))).toBe(
            "master↑0↓0"
        );
        expect(
            formatGitFolderStatus(
                status({ branch: "master", ahead: 3, behind: 1 })
            )
        ).toBe("master↑3↓1");
    });

    it("keeps the zero side so the pair always reads the same way", () => {
        expect(formatGitFolderStatus(status({ ahead: 2 }))).toBe("master↑2↓0");
        expect(formatGitFolderStatus(status({ behind: 4 }))).toBe(
            "master↑0↓4"
        );
    });

    it("omits the divergence when the branch has no upstream", () => {
        expect(
            formatGitFolderStatus(
                status({ branch: "w-cli-git", hasUpstream: false })
            )
        ).toBe("w-cli-git");
    });

    it("appends the line deltas only when there are changes", () => {
        expect(
            formatGitFolderStatus(
                status({ branch: "master", added: 12, removed: 3 })
            )
        ).toBe("master↑0↓0(+12,-3)");
        expect(
            formatGitFolderStatus(status({ branch: "master", added: 5 }))
        ).toBe("master↑0↓0(+5,-0)");
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
