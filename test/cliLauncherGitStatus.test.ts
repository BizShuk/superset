// `git diff --numstat` 的解析與 description 格式化。純字串進出,
// 不 spawn 任何行程。

import { describe, it, expect } from "vitest";
import {
    formatGitFolderDescription,
    formatGitFolderStatus,
    parseNumstat,
} from "../src/cliLauncher/gitStatus";

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

describe("formatGitFolderStatus", () => {
    it("renders the branch with its line deltas", () => {
        expect(
            formatGitFolderStatus({ branch: "master", added: 12, removed: 3 })
        ).toBe("master(+12,-3)");
    });

    it("keeps zeros so the branch stays visible on a clean repository", () => {
        expect(
            formatGitFolderStatus({ branch: "master", added: 0, removed: 0 })
        ).toBe("master(+0,-0)");
    });

    it("renders nothing when there is no git information", () => {
        expect(formatGitFolderStatus(undefined)).toBe("");
    });

    it("renders nothing when the branch could not be resolved", () => {
        expect(
            formatGitFolderStatus({ branch: "", added: 5, removed: 5 })
        ).toBe("");
    });
});

describe("formatGitFolderDescription", () => {
    it("hides the default branch when there is nothing pending", () => {
        for (const branch of ["master", "main"]) {
            expect(
                formatGitFolderDescription({ branch, added: 0, removed: 0 })
            ).toBe("");
        }
    });

    it("keeps the default branch as soon as there are changes", () => {
        expect(
            formatGitFolderDescription({
                branch: "master",
                added: 1,
                removed: 0,
            })
        ).toBe("master(+1,-0)");
    });

    it("keeps a clean non-default branch — which branch you are on is the point", () => {
        expect(
            formatGitFolderDescription({
                branch: "w-cli-git",
                added: 0,
                removed: 0,
            })
        ).toBe("w-cli-git(+0,-0)");
    });

    it("renders nothing without git information", () => {
        expect(formatGitFolderDescription(undefined)).toBe("");
    });
});
