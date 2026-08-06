import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "../src/cliLauncher/catalog";
import type { CLIEntry } from "../src/cliLauncher/entries";
import type { ScannedFolder } from "../src/cliLauncher/scan";
import * as focus from "../src/cliLauncher/focus";

const HOME = "/Users/tester";

function entry(target: string, label?: string): CLIEntry {
    return {
        id: target,
        label: label ?? target.slice(target.lastIndexOf("/") + 1),
        path: target,
    };
}

const api = focus as unknown as Record<string, unknown>;

function focusFunction<T>(name: string): T {
    const candidate = api[name];
    expect(candidate, `${name} must be implemented`).toBeTypeOf("function");
    return candidate as T;
}

describe("CLI Launcher Focus paths", () => {
    it("normalizes exact literal paths and drops invalid or duplicate values", () => {
        const normalizeFocusedPaths = focusFunction<
            (raw: unknown, homeDir: string) => string[]
        >("normalizeFocusedPaths");

        expect(
            normalizeFocusedPaths(
                [
                    "~/projects/platform/superset",
                    42,
                    "  ",
                    "~/projects/platform/superset",
                    "/opt/manual",
                ],
                HOME
            )
        ).toEqual([
            `${HOME}/projects/platform/superset`,
            "/opt/manual",
        ]);
        expect(normalizeFocusedPaths({ path: "/opt/manual" }, HOME)).toEqual(
            []
        );
    });

    it("adds a normalized path once while preserving valid existing order", () => {
        const appendFocusedPath = focusFunction<
            (
                raw: unknown,
                targetPath: string,
                homeDir: string
            ) => string[] | undefined
        >("appendFocusedPath");

        expect(
            appendFocusedPath(
                ["~/projects/platform/superset", 42],
                "/opt/manual",
                HOME
            )
        ).toEqual(["~/projects/platform/superset", "/opt/manual"]);
        expect(
            appendFocusedPath(
                ["~/projects/platform/superset"],
                `${HOME}/projects/platform/superset`,
                HOME
            )
        ).toBeUndefined();
    });

    it("removes a normalized path and does not rewrite on a missing target", () => {
        const removeFocusedPath = focusFunction<
            (
                raw: unknown,
                targetPath: string,
                homeDir: string
            ) => string[] | undefined
        >("removeFocusedPath");

        expect(
            removeFocusedPath(
                ["~/projects/platform/superset", "/opt/manual", 42],
                `${HOME}/projects/platform/superset`,
                HOME
            )
        ).toEqual(["/opt/manual"]);
        expect(
            removeFocusedPath(["/opt/manual"], "/missing", HOME)
        ).toBeUndefined();
    });

    it("keeps exact Focused paths and the ancestor needed to reach a focused child", () => {
        const projectFocusedPaths = focusFunction<
            (
                entries: readonly CatalogEntry[],
                folders: readonly ScannedFolder[],
                focusedPaths: readonly string[],
                focusedOnly: boolean
            ) => { entries: CatalogEntry[]; folders: ScannedFolder[] }
        >("projectFocusedPaths");

        const manual: CatalogEntry = {
            source: "literal",
            entry: entry("/opt/manual", "Manual"),
        };
        const platform = entry(`${HOME}/projects/platform`);
        const superset = entry(`${platform.path}/superset`);
        const gateway = entry(`${platform.path}/gateway`);
        const ai = entry(`${HOME}/projects/ai`);
        const sessiond = entry(`${ai.path}/sessiond`);
        const folders: ScannedFolder[] = [
            { entry: platform, children: [superset, gateway] },
            { entry: ai, children: [sessiond] },
        ];

        expect(
            projectFocusedPaths(
                [manual],
                folders,
                [manual.entry.path, superset.path, ai.path],
                true
            )
        ).toEqual({
            entries: [manual],
            folders: [
                { entry: platform, children: [superset] },
                { entry: ai, children: [] },
            ],
        });
    });

    it("leaves the complete projection untouched while Focus-only mode is off", () => {
        const projectFocusedPaths = focusFunction<
            (
                entries: readonly CatalogEntry[],
                folders: readonly ScannedFolder[],
                focusedPaths: readonly string[],
                focusedOnly: boolean
            ) => { entries: CatalogEntry[]; folders: ScannedFolder[] }
        >("projectFocusedPaths");
        const manual: CatalogEntry = {
            source: "literal",
            entry: entry("/opt/manual", "Manual"),
        };
        const folders = [
            {
                entry: entry(`${HOME}/projects/platform`),
                children: [entry(`${HOME}/projects/platform/superset`)],
            },
        ];

        expect(projectFocusedPaths([manual], folders, [], false)).toEqual({
            entries: [manual],
            folders,
        });
        expect(projectFocusedPaths([manual], folders, [], true)).toEqual({
            entries: [],
            folders: [],
        });
    });
});
