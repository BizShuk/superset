import { describe, it, expect } from "vitest";
import {
    filterCLIEntries,
    filterScannedFolders,
    isSubsequenceMatch,
    matchesCLIEntry,
    normalizeFilterQuery,
    pathSegments,
    splitFilterQuery,
} from "../src/cliLauncher/filter";
import type { CLIEntry } from "../src/cliLauncher/entries";
import type { ScannedFolder } from "../src/cliLauncher/scan";

const HOME = "/Users/tester";

function entry(target: string, label?: string): CLIEntry {
    return {
        id: target,
        label: label ?? target.slice(target.lastIndexOf("/") + 1),
        path: target,
    };
}

describe("normalizeFilterQuery", () => {
    it("lowercases and drops all whitespace", () => {
        expect(normalizeFilterQuery("  PL sup ")).toBe("plsup");
    });

    it("maps a blank query to the empty string", () => {
        expect(normalizeFilterQuery("   ")).toBe("");
    });

    it("maps a separator-only query to the empty string", () => {
        // 只有分隔符沒有任何條件,不該讓面板顯示成「過濾中」。
        expect(normalizeFilterQuery("~/")).toBe("");
        expect(normalizeFilterQuery("//")).toBe("");
    });
});

describe("splitFilterQuery", () => {
    it("splits on slashes and drops empty and tilde parts", () => {
        expect(splitFilterQuery("~/pl//sup/")).toEqual(["pl", "sup"]);
    });
});

describe("pathSegments", () => {
    it("keeps only the meaningful segments of a shown path", () => {
        expect(pathSegments("~/projects/platform/superset")).toEqual([
            "projects",
            "platform",
            "superset",
        ]);
    });
});

describe("isSubsequenceMatch", () => {
    it("matches characters in order without requiring adjacency", () => {
        expect(isSubsequenceMatch("spst", "superset")).toBe(true);
    });

    it("matches a contiguous substring too", () => {
        expect(isSubsequenceMatch("superset", "superset")).toBe(true);
    });

    it("rejects characters that appear out of order", () => {
        expect(isSubsequenceMatch("tsu", "superset")).toBe(false);
    });

    it("rejects a character that is missing entirely", () => {
        expect(isSubsequenceMatch("plz", "platform")).toBe(false);
    });

    it("is case-insensitive on the target", () => {
        expect(isSubsequenceMatch("gosdk", "GoSDK")).toBe(true);
    });

    it("treats the empty query as matching everything", () => {
        expect(isSubsequenceMatch("", "projects")).toBe(true);
    });
});

describe("matchesCLIEntry", () => {
    it("matches a single segment of the path", () => {
        expect(
            matchesCLIEntry(entry(`${HOME}/projects/tools/pm2`), "tool", HOME)
        ).toBe(true);
    });

    // 回歸測試:攤平整條路徑做 subsequence 時,`tool` 會從 projec(t)s +
    // c(o)llecti(o)ns + p(l)ans 湊出來而誤命中。
    it("never lets a query span the path separator", () => {
        for (const target of [
            `${HOME}/projects/collections/plans`,
            `${HOME}/projects/product/foreclosed`,
            `${HOME}/projects/product/surfer_profile`,
        ]) {
            expect(matchesCLIEntry(entry(target), "tool", HOME)).toBe(false);
        }
    });

    it("matches segment by segment when the query has slashes", () => {
        const superset = entry(`${HOME}/projects/platform/superset`);
        expect(matchesCLIEntry(superset, "pl/sup", HOME)).toBe(true);
        // 段可以跳過,但不能倒退。
        expect(matchesCLIEntry(superset, "pj/sup", HOME)).toBe(true);
        expect(matchesCLIEntry(superset, "sup/pl", HOME)).toBe(false);
    });

    it("requires every query segment to land somewhere", () => {
        expect(
            matchesCLIEntry(
                entry(`${HOME}/projects/platform/superset`),
                "pl/sup/zzz",
                HOME
            )
        ).toBe(false);
    });

    it("matches a custom label that is absent from the path", () => {
        expect(
            matchesCLIEntry(entry("/opt/tools/x1", "Nightly Build"), "nb", HOME)
        ).toBe(true);
    });

    it("does not fall back to the label for a multi-segment query", () => {
        expect(
            matchesCLIEntry(
                entry("/opt/tools/x1", "Nightly Build"),
                "opt/nb",
                HOME
            )
        ).toBe(false);
    });

    it("rejects entries matched by neither path nor label", () => {
        expect(matchesCLIEntry(entry("/opt/tools/x1"), "zzz", HOME)).toBe(false);
    });
});

describe("filterCLIEntries", () => {
    const pinned = [
        entry(`${HOME}/projects/platform/superset`),
        entry(`${HOME}/projects/ai/sessiond`),
        entry("/opt/tools/cli"),
    ];

    it("returns a copy of the list for an empty query", () => {
        const all = filterCLIEntries(pinned, "", HOME);
        expect(all).toEqual(pinned);
        expect(all).not.toBe(pinned);
    });

    it("keeps only matching entries, in the original order", () => {
        expect(
            filterCLIEntries(pinned, "ss", HOME).map((item) => item.path)
        ).toEqual([
            `${HOME}/projects/platform/superset`,
            `${HOME}/projects/ai/sessiond`,
        ]);
    });
});

describe("filterScannedFolders", () => {
    const folders: ScannedFolder[] = [
        {
            entry: entry(`${HOME}/projects/platform`),
            children: [
                entry(`${HOME}/projects/platform/superset`),
                entry(`${HOME}/projects/platform/gateway`),
            ],
        },
        {
            entry: entry(`${HOME}/projects/ai`),
            children: [entry(`${HOME}/projects/ai/sessiond`)],
        },
        {
            entry: entry(`${HOME}/projects/empty`),
            children: [],
        },
    ];

    it("returns every folder for an empty query", () => {
        expect(filterScannedFolders(folders, "", HOME)).toEqual(folders);
    });

    it("keeps all children when the first layer itself matches", () => {
        const kept = filterScannedFolders(folders, "platform", HOME);
        expect(kept).toHaveLength(1);
        expect(kept[0].children.map((child) => child.label)).toEqual([
            "superset",
            "gateway",
        ]);
    });

    it("keeps a non-matching parent only for its matching children", () => {
        const kept = filterScannedFolders(folders, "gateway", HOME);
        expect(kept).toHaveLength(1);
        expect(kept[0].entry.label).toBe("platform");
        expect(kept[0].children.map((child) => child.label)).toEqual([
            "gateway",
        ]);
    });

    it("drops folders where neither the parent nor any child matches", () => {
        expect(filterScannedFolders(folders, "zzz", HOME)).toEqual([]);
    });

    it("matches a two-layer query written with a slash", () => {
        const kept = filterScannedFolders(folders, "pl/sup", HOME);
        expect(kept.map((folder) => folder.entry.label)).toEqual(["platform"]);
        expect(kept[0].children.map((child) => child.label)).toEqual([
            "superset",
        ]);
    });

    it("never mutates the input folders", () => {
        filterScannedFolders(folders, "superset", HOME);
        expect(folders[0].children).toHaveLength(2);
    });
});
