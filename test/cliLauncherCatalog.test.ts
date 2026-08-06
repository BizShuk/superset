import { describe, expect, it } from "vitest";
import { buildCLILauncherCatalog } from "../src/cliLauncher/catalog";
import {
    normalizeEntrySelectors,
    normalizeHiddenRules,
    type CLIEntry,
} from "../src/cliLauncher/entries";
import type { ScannedFolder } from "../src/cliLauncher/scan";

const HOME = "/Users/tester";

function entry(target: string, label?: string): CLIEntry {
    return {
        id: target,
        label: label ?? target.slice(target.lastIndexOf("/") + 1),
        path: target,
    };
}

const SCANNED: ScannedFolder[] = [
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
];

describe("buildCLILauncherCatalog", () => {
    it("expands Regex entries from two-layer scan candidates in settings order", () => {
        const selectors = normalizeEntrySelectors(
            [
                { regex: "(?:^|/)superset$" },
                { path: "/opt/manual", label: "Manual" },
                { regex: "^~/projects/ai/sessiond$" },
            ],
            HOME
        );

        const catalog = buildCLILauncherCatalog(
            selectors,
            SCANNED,
            [],
            HOME
        );

        expect(catalog.entries).toEqual([
            {
                source: "regex",
                entry: entry(`${HOME}/projects/platform/superset`),
            },
            {
                source: "literal",
                entry: entry("/opt/manual", "Manual"),
            },
            {
                source: "regex",
                entry: entry(`${HOME}/projects/ai/sessiond`),
            },
        ]);
        expect(catalog.folders[0].children).toEqual([
            entry(`${HOME}/projects/platform/gateway`),
        ]);
        expect(catalog.folders[1].children).toEqual([]);
    });

    it("lets an explicit literal entry override Regex selection and hidden rules", () => {
        const target = `${HOME}/projects/platform/superset`;
        const selectors = normalizeEntrySelectors(
            [
                { regex: "(?:^|/)superset$" },
                { path: target, label: "Explicit Superset" },
            ],
            HOME
        );
        const hidden = normalizeHiddenRules(
            [{ regex: "(?:^|/)superset$" }],
            HOME
        );

        const catalog = buildCLILauncherCatalog(
            selectors,
            SCANNED,
            hidden,
            HOME
        );

        expect(catalog.entries).toEqual([
            {
                source: "literal",
                entry: entry(target, "Explicit Superset"),
            },
        ]);
        expect(JSON.stringify(catalog.folders)).not.toContain("superset");
    });

    it("lets hidden rules suppress Dynamic Entries and whole matched subtrees", () => {
        const selectors = normalizeEntrySelectors(
            [
                { regex: "(?:^|/)(gateway|sessiond)$" },
                { regex: "(?:^|/)platform$" },
            ],
            HOME
        );
        const hidden = normalizeHiddenRules(
            [
                { regex: "(?:^|/)gateway$" },
                { regex: "(?:^|/)platform$" },
            ],
            HOME
        );

        const catalog = buildCLILauncherCatalog(
            selectors,
            SCANNED,
            hidden,
            HOME
        );

        expect(catalog.entries.map(({ entry }) => entry.label)).toEqual([
            "sessiond",
        ]);
        expect(catalog.folders.map(({ entry }) => entry.label)).toEqual([
            "ai",
        ]);
        expect(catalog.folders[0].children).toEqual([]);
    });
});
