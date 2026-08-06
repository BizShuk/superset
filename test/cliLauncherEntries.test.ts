import { describe, it, expect } from "vitest";
import {
    appendEntryPath,
    appendHiddenPath,
    collapseHome,
    expandHome,
    formatHiddenRule,
    formatPathList,
    isHiddenPath,
    normalizeEntries,
    normalizeEntrySelectors,
    normalizeHiddenRules,
    normalizeHiddenPaths,
    normalizeRootPaths,
    removeEntryPath,
    removeHiddenRule,
    removeHiddenPath,
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

describe("normalizeEntrySelectors", () => {
    it("keeps literal entries and validated Regex rules in settings order", () => {
        const selectors = normalizeEntrySelectors(
            [
                { path: "~/projects/app", label: "App" },
                { regex: "(?:^|/)superset$", flags: "i" },
            ],
            HOME
        );

        expect(selectors[0]).toEqual({
            kind: "literal",
            entry: {
                id: "/Users/tester/projects/app",
                label: "App",
                path: "/Users/tester/projects/app",
            },
        });
        expect(selectors[1]).toMatchObject({
            kind: "regex",
            source: "(?:^|/)superset$",
            flags: "i",
        });
    });

    it("ignores invalid Regex source and flags without dropping valid literals", () => {
        const selectors = normalizeEntrySelectors(
            [
                { regex: "[" },
                { regex: "superset", flags: "ii" },
                "/opt/web",
            ],
            HOME
        );

        expect(selectors).toEqual([
            {
                kind: "literal",
                entry: { id: "/opt/web", label: "web", path: "/opt/web" },
            },
        ]);
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

    it("preserves Regex selectors while appending a literal path", () => {
        expect(
            appendEntryPath(
                [{ regex: "(?:^|/)superset$", flags: "i" }],
                "/opt/web",
                HOME
            )
        ).toEqual([
            { regex: "(?:^|/)superset$", flags: "i" },
            { path: "/opt/web" },
        ]);
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

    it("preserves Regex selectors while removing a literal path", () => {
        expect(
            removeEntryPath(
                [{ regex: "superset$" }, { path: "/opt/web" }],
                "/opt/web",
                HOME
            )
        ).toEqual([{ regex: "superset$" }]);
    });
});

describe("normalizeHiddenPaths", () => {
    it("expands tildes and drops duplicates and non-strings", () => {
        expect(
            normalizeHiddenPaths(
                ["~/projects/app", "/Users/tester/projects/app", 42, "  "],
                HOME
            )
        ).toEqual(["/Users/tester/projects/app"]);
    });

    it("returns an empty list for a non-array", () => {
        expect(normalizeHiddenPaths("nope", HOME)).toEqual([]);
    });
});

describe("normalizeHiddenRules", () => {
    it("normalizes literal paths and validated Regex rules", () => {
        const rules = normalizeHiddenRules(
            [
                "~/projects/app",
                { regex: "(?:^|/)(docs|plans)$", flags: "i" },
            ],
            HOME
        );

        expect(rules[0]).toBe("/Users/tester/projects/app");
        expect(rules[1]).toMatchObject({
            kind: "regex",
            source: "(?:^|/)(docs|plans)$",
            flags: "i",
        });
    });

    it("deduplicates equivalent Regex rules and ignores invalid ones", () => {
        const rules = normalizeHiddenRules(
            [
                { regex: "docs$", flags: "i" },
                { regex: "docs$", flags: "i" },
                { regex: "[" },
            ],
            HOME
        );

        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({ source: "docs$", flags: "i" });
    });
});

describe("isHiddenPath", () => {
    it("matches the path itself", () => {
        expect(isHiddenPath("/opt/web", ["/opt/web"])).toBe(true);
    });

    it("matches any descendant of a hidden folder", () => {
        expect(isHiddenPath("/opt/web/api", ["/opt/web"])).toBe(true);
    });

    it("does not match a sibling sharing the name prefix", () => {
        expect(isHiddenPath("/opt/website", ["/opt/web"])).toBe(false);
    });

    it("is false with nothing hidden", () => {
        expect(isHiddenPath("/opt/web", [])).toBe(false);
    });

    it("matches Regex rules against normalized absolute and tilde paths", () => {
        const rules = normalizeHiddenRules(
            [
                { regex: "^~/projects/WEB/docs$", flags: "i" },
                { regex: "^/opt/private$" },
            ],
            HOME
        );

        expect(
            isHiddenPath("/Users/tester/projects/web/docs", rules, HOME)
        ).toBe(true);
        expect(isHiddenPath("/opt/private", rules, HOME)).toBe(true);
    });

    it("treats a Regex-matched ancestor as hiding its descendants", () => {
        const rules = normalizeHiddenRules(
            [{ regex: "(?:^|/)docs$" }],
            HOME
        );

        expect(
            isHiddenPath("/Users/tester/projects/web/docs/api", rules, HOME)
        ).toBe(true);
        expect(
            isHiddenPath("/Users/tester/projects/web/docsite", rules, HOME)
        ).toBe(false);
    });
});

describe("appendHiddenPath", () => {
    it("appends the tilde form and keeps existing values", () => {
        expect(
            appendHiddenPath(["/opt/web"], "/Users/tester/projects/app", HOME)
        ).toEqual(["/opt/web", "~/projects/app"]);
    });

    it("returns undefined when the path is already hidden", () => {
        expect(
            appendHiddenPath(
                ["~/projects/app"],
                "/Users/tester/projects/app",
                HOME
            )
        ).toBeUndefined();
    });

    it("returns undefined for a blank path", () => {
        expect(appendHiddenPath([], "   ", HOME)).toBeUndefined();
    });

    it("preserves Regex rules while appending a literal path", () => {
        expect(
            appendHiddenPath(
                [{ regex: "(?:^|/)docs$" }],
                "/opt/web",
                HOME
            )
        ).toEqual([{ regex: "(?:^|/)docs$" }, "/opt/web"]);
    });
});

describe("removeHiddenPath", () => {
    it("removes the matching path regardless of tilde form", () => {
        expect(
            removeHiddenPath(
                ["~/projects/app", "/opt/web"],
                "/Users/tester/projects/app",
                HOME
            )
        ).toEqual(["/opt/web"]);
    });

    it("returns undefined when nothing matched", () => {
        expect(removeHiddenPath(["/opt/web"], "/opt/other", HOME)).toBeUndefined();
    });

    it("preserves Regex rules while removing a literal path", () => {
        expect(
            removeHiddenPath(
                [{ regex: "docs$" }, "/opt/web"],
                "/opt/web",
                HOME
            )
        ).toEqual([{ regex: "docs$" }]);
    });
});

describe("removeHiddenRule", () => {
    it("removes a Regex rule by normalized identity and keeps other rules", () => {
        const raw = [
            "~/projects/app",
            { regex: "docs$", flags: "i" },
            { regex: "plans$" },
        ];
        const selected = normalizeHiddenRules(raw, HOME)[1];

        expect(removeHiddenRule(raw, selected, HOME)).toEqual([
            "~/projects/app",
            { regex: "plans$" },
        ]);
    });
});

describe("formatHiddenRule", () => {
    it("formats literal paths and Regex rules for Restore Hidden Paths", () => {
        const regex = normalizeHiddenRules(
            [{ regex: "(?:^|/)docs$", flags: "i" }],
            HOME
        )[0];

        expect(formatHiddenRule("/Users/tester/projects/app", HOME)).toBe(
            "~/projects/app"
        );
        expect(formatHiddenRule(regex, HOME)).toBe("/(?:^|/)docs$/i");
    });
});
