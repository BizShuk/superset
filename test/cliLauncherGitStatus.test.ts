// `git status --porcelain=v1` 的解析與 description 格式化。純字串進出,
// 不 spawn 任何行程。

import { describe, it, expect } from "vitest";
import {
    formatGitPendingCounts,
    parseGitStatus,
} from "../src/cliLauncher/gitStatus";

describe("parseGitStatus", () => {
    it("returns zeros for a clean worktree", () => {
        expect(parseGitStatus("")).toEqual({
            staged: 0,
            unstaged: 0,
            untracked: 0,
        });
    });

    it("splits index and worktree columns", () => {
        const output = [
            "M  src/staged.ts",
            " M src/unstaged.ts",
            "MM src/both.ts",
            "A  src/added.ts",
            " D src/deleted.ts",
            "?? src/new.ts",
            "?? docs/",
            "",
        ].join("\n");

        expect(parseGitStatus(output)).toEqual({
            staged: 3, // M , MM, A
            unstaged: 3, // M, MM, D
            untracked: 2,
        });
    });

    it("counts unmerged entries on both sides", () => {
        expect(parseGitStatus("UU src/conflict.ts\n")).toEqual({
            staged: 1,
            unstaged: 1,
            untracked: 0,
        });
    });

    it("ignores ignored entries and short lines", () => {
        expect(parseGitStatus("!! out/bundle.js\n\nx\n")).toEqual({
            staged: 0,
            unstaged: 0,
            untracked: 0,
        });
    });

    it("counts a rename as one staged change", () => {
        expect(parseGitStatus("R  old.ts -> new.ts\n")).toEqual({
            staged: 1,
            unstaged: 0,
            untracked: 0,
        });
    });
});

describe("formatGitPendingCounts", () => {
    it("renders staged, unstaged and the bare untracked count", () => {
        expect(
            formatGitPendingCounts({ staged: 1, unstaged: 2, untracked: 3 })
        ).toBe("staged:1 unstaged:2 3");
    });

    it("renders nothing when there is no git information", () => {
        expect(formatGitPendingCounts(undefined)).toBe("");
    });

    it("renders nothing for a clean repository", () => {
        expect(
            formatGitPendingCounts({ staged: 0, unstaged: 0, untracked: 0 })
        ).toBe("");
    });

    it("keeps zero columns once anything is pending", () => {
        expect(
            formatGitPendingCounts({ staged: 0, unstaged: 0, untracked: 4 })
        ).toBe("staged:0 unstaged:0 4");
    });
});
