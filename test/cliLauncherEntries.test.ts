import { describe, it, expect } from "vitest";
import {
    appendEntryPath,
    collapseHome,
    expandHome,
    formatPathList,
    normalizeEntries,
    normalizeRootPaths,
    removeEntryPath,
    toCLIEntry,
} from "../src/cliLauncher/entries";

const HOME = "/Users/tester";

describe("expandHome", () => {
    it("expands a bare tilde to the home directory", () => {
        expect(expandHome("~", HOME)).toBe(HOME);
    });

    it("expands a tilde prefix", () => {
        expect(expandHome("~/projects/app", HOME)).toBe(
            "/Users/tester/projects/app"
        );
    });

    it("leaves absolute paths untouched but normalizes them", () => {
        expect(expandHome("/opt//tools/../tools/cli", HOME)).toBe(
            "/opt/tools/cli"
        );
    });

    it("does not expand ~user forms", () => {
        expect(expandHome("~other/projects", HOME)).toBe(
            `${process.cwd()}/~other/projects`
        );
    });

    it("returns an empty string for blank input", () => {
        expect(expandHome("   ", HOME)).toBe("");
    });
});

describe("collapseHome", () => {
    it("shortens paths under home", () => {
        expect(collapseHome("/Users/tester/projects/app", HOME)).toBe(
            "~/projects/app"
        );
    });

    it("leaves unrelated paths alone", () => {
        expect(collapseHome("/opt/tools", HOME)).toBe("/opt/tools");
    });

    it("does not collapse a sibling directory with the same prefix", () => {
        expect(collapseHome("/Users/tester2/app", HOME)).toBe(
            "/Users/tester2/app"
        );
    });
});

describe("normalizeEntries", () => {
    it("accepts the string shorthand and derives a label from the basename", () => {
        expect(normalizeEntries(["~/projects/app"], HOME)).toEqual([
            {
                id: "/Users/tester/projects/app",
                label: "app",
                path: "/Users/tester/projects/app",
            },
        ]);
    });

    it("keeps an explicit trimmed label", () => {
        expect(
            normalizeEntries([{ label: " Web ", path: "/opt/web" }], HOME)
        ).toEqual([{ id: "/opt/web", label: "Web", path: "/opt/web" }]);
    });

    it("drops invalid items and keeps the first of duplicate paths", () => {
        const entries = normalizeEntries(
            [
                42,
                null,
                { label: "no path" },
                { path: "  " },
                { label: "first", path: "~/projects/app" },
                { label: "second", path: "/Users/tester/projects/app" },
                "/opt/web",
            ],
            HOME
        );

        expect(entries.map((entry) => entry.label)).toEqual(["first", "web"]);
    });

    it("returns an empty list when the setting is not an array", () => {
        expect(normalizeEntries(undefined, HOME)).toEqual([]);
        expect(normalizeEntries({ path: "/opt/web" }, HOME)).toEqual([]);
    });
});

describe("toCLIEntry", () => {
    const ENTRY = { id: "/opt/web", label: "web", path: "/opt/web" };

    it("unwraps a tree item that carries the entry", () => {
        expect(
            toCLIEntry({ entry: ENTRY, label: "web", collapsibleState: 0 })
        ).toEqual(ENTRY);
    });

    it("accepts a plain entry passed as a command argument", () => {
        expect(toCLIEntry(ENTRY)).toEqual(ENTRY);
    });

    it("accepts a bare path object and derives the label", () => {
        expect(toCLIEntry({ path: "/opt/web" })).toEqual(ENTRY);
    });

    it("accepts a Uri-shaped argument", () => {
        expect(toCLIEntry({ fsPath: "/opt/web" })).toEqual(ENTRY);
        expect(toCLIEntry({ resourceUri: { fsPath: "/opt/web" } })).toEqual(
            ENTRY
        );
    });

    it("returns undefined for palette invocations and junk", () => {
        expect(toCLIEntry(undefined)).toBeUndefined();
        expect(toCLIEntry(null)).toBeUndefined();
        expect(toCLIEntry("/opt/web")).toBeUndefined();
        expect(toCLIEntry({})).toBeUndefined();
        expect(toCLIEntry({ path: "   " })).toBeUndefined();
    });
});

describe("formatPathList", () => {
    it("joins each entry path on its own line, in order", () => {
        expect(
            formatPathList([
                { id: "/opt/web", label: "web", path: "/opt/web" },
                { id: "/opt/api", label: "api", path: "/opt/api" },
            ])
        ).toBe("/opt/web\n/opt/api");
    });

    it("uses the absolute path, not a tilde-collapsed one", () => {
        expect(
            formatPathList([
                {
                    id: "/Users/tester/projects/app",
                    label: "app",
                    path: "/Users/tester/projects/app",
                },
            ])
        ).toBe("/Users/tester/projects/app");
    });

    it("returns an empty string for an empty list", () => {
        expect(formatPathList([])).toBe("");
    });
});

describe("normalizeRootPaths", () => {
    it("expands tilde and deduplicates", () => {
        expect(
            normalizeRootPaths(
                ["~/projects", "/Users/tester/projects", "/opt/work"],
                HOME
            )
        ).toEqual(["/Users/tester/projects", "/opt/work"]);
    });

    it("drops non-strings and blanks", () => {
        expect(normalizeRootPaths([42, null, "  ", "~/projects"], HOME)).toEqual(
            ["/Users/tester/projects"]
        );
    });

    it("returns an empty list when scanning is disabled", () => {
        expect(normalizeRootPaths([], HOME)).toEqual([]);
        expect(normalizeRootPaths(undefined, HOME)).toEqual([]);
    });
});

describe("appendEntryPath", () => {
    it("appends a new path collapsed back to tilde form", () => {
        expect(
            appendEntryPath(["/opt/web"], "/Users/tester/projects/app", HOME)
        ).toEqual(["/opt/web", { path: "~/projects/app" }]);
    });

    it("starts a fresh list when the setting is missing", () => {
        expect(appendEntryPath(undefined, "/opt/web", HOME)).toEqual([
            { path: "/opt/web" },
        ]);
    });

    it("returns undefined for a duplicate path", () => {
        expect(
            appendEntryPath(
                [{ path: "~/projects/app" }],
                "/Users/tester/projects/app",
                HOME
            )
        ).toBeUndefined();
    });

    it("returns undefined for a blank path", () => {
        expect(appendEntryPath([], "  ", HOME)).toBeUndefined();
    });
});

describe("removeEntryPath", () => {
    it("removes the matching entry regardless of tilde form", () => {
        expect(
            removeEntryPath(
                [{ path: "~/projects/app" }, "/opt/web"],
                "/Users/tester/projects/app",
                HOME
            )
        ).toEqual(["/opt/web"]);
    });

    it("returns undefined when nothing matched", () => {
        expect(removeEntryPath(["/opt/web"], "/opt/other", HOME)).toBeUndefined();
    });
});
