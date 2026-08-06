import { describe, expect, it } from "vitest";
import { parseGitStatus } from "../src/cliLauncher/scmStatus";

describe("parseGitStatus", () => {
    it("groups modified, added, deleted, and conflicted records", () => {
        expect(
            parseGitStatus(
                " M src/a.ts\0?? src/new.ts\0 D old.ts\0UU conflict.ts\0"
            )
        ).toEqual([
            {
                group: "unstaged",
                marker: "U",
                path: "src/a.ts",
                indexStatus: " ",
                workTreeStatus: "M",
            },
            {
                group: "untracked",
                marker: "A",
                path: "src/new.ts",
                indexStatus: "?",
                workTreeStatus: "?",
            },
            {
                group: "unstaged",
                marker: "D",
                path: "old.ts",
                indexStatus: " ",
                workTreeStatus: "D",
            },
            {
                group: "unstaged",
                marker: "!",
                path: "conflict.ts",
                indexStatus: "U",
                workTreeStatus: "U",
            },
        ]);
    });

    it("keeps the original path from NUL-delimited rename and copy records", () => {
        expect(
            parseGitStatus("R  src/new.ts\0src/old.ts\0 C copied.ts\0base.ts\0")
        ).toEqual([
            {
                group: "staged",
                marker: "U",
                path: "src/new.ts",
                originalPath: "src/old.ts",
                indexStatus: "R",
                workTreeStatus: " ",
            },
            {
                group: "unstaged",
                marker: "U",
                path: "copied.ts",
                originalPath: "base.ts",
                indexStatus: " ",
                workTreeStatus: "C",
            },
        ]);
    });

    it("preserves paths containing newlines because porcelain output is NUL-delimited", () => {
        expect(parseGitStatus("?? docs/line\nbreak.md\0")).toEqual([
            {
                group: "untracked",
                marker: "A",
                path: "docs/line\nbreak.md",
                indexStatus: "?",
                workTreeStatus: "?",
            },
        ]);
    });

    it.each(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])(
        "classifies the %s unmerged status as a conflict before add/delete",
        (status) => {
            expect(parseGitStatus(`${status} conflict.txt\0`)).toEqual([
                {
                    group: "unstaged",
                    marker: "!",
                    path: "conflict.txt",
                    indexStatus: status[0],
                    workTreeStatus: status[1],
                },
            ]);
        }
    );

    it("projects mixed index and worktree states into separate staged and unstaged entries", () => {
        expect(
            parseGitStatus(
                "MM both.ts\0AM added-then-edited.ts\0MD changed-then-deleted.ts\0"
            )
        ).toEqual([
            {
                group: "staged",
                marker: "U",
                path: "both.ts",
                indexStatus: "M",
                workTreeStatus: "M",
            },
            {
                group: "unstaged",
                marker: "U",
                path: "both.ts",
                indexStatus: "M",
                workTreeStatus: "M",
            },
            {
                group: "staged",
                marker: "A",
                path: "added-then-edited.ts",
                indexStatus: "A",
                workTreeStatus: "M",
            },
            {
                group: "unstaged",
                marker: "U",
                path: "added-then-edited.ts",
                indexStatus: "A",
                workTreeStatus: "M",
            },
            {
                group: "staged",
                marker: "U",
                path: "changed-then-deleted.ts",
                indexStatus: "M",
                workTreeStatus: "D",
            },
            {
                group: "unstaged",
                marker: "D",
                path: "changed-then-deleted.ts",
                indexStatus: "M",
                workTreeStatus: "D",
            },
        ]);
    });

    it("ignores malformed and ignored records without breaking later changes", () => {
        expect(parseGitStatus("bad\0!! ignored.txt\0M  valid.ts\0")).toEqual([
            {
                group: "staged",
                marker: "U",
                path: "valid.ts",
                indexStatus: "M",
                workTreeStatus: " ",
            },
        ]);
    });
});
