import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface ManifestMenuItem {
    readonly command: string;
    readonly when?: string;
    readonly group?: string;
}

interface ManifestCommand {
    readonly command: string;
    readonly title: string;
    readonly icon?: string;
}

interface ManifestView {
    readonly id: string;
    readonly name: string;
    readonly contextualTitle?: string;
    readonly visibility?: string;
    readonly initialSize?: number;
}

interface SupersetManifest {
    readonly icon?: string;
    readonly enabledApiProposals?: string[];
    readonly contributes: {
        readonly commands: ManifestCommand[];
        readonly menus: Record<string, ManifestMenuItem[]>;
        readonly views: Record<string, ManifestView[]>;
        readonly [key: string]: unknown;
    };
}

const manifestPath = fileURLToPath(
    new URL("../package.json", import.meta.url)
);
const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8")
) as SupersetManifest;

describe("Git hooks manifest contributions", () => {
    it("publishes separate install and link commands", () => {
        expect(manifest.contributes.commands).toContainEqual({
            command: "superset.installGitHooks",
            title: "Superset: Install Git Hooks",
        });
        expect(manifest.contributes.commands).toContainEqual({
            command: "superset.linkGitHooks",
            title: "Superset: Link Git Hooks",
        });
    });

    it("uses only pkg/resources manifest assets", () => {
        expect(manifest.icon).toBe("pkg/resources/icon.png");
        for (const command of manifest.contributes.commands) {
            if (command.icon && !command.icon.startsWith("$(")) {
                expect(command.icon).toMatch(/^pkg\/resources\//);
            }
        }
    });
});

describe("Projects Setup manifest contribution", () => {
    it("publishes the Projects Setup command with its clone icon", () => {
        expect(manifest.contributes.commands).toContainEqual({
            command: "superset.projectsSetup",
            title: "Superset: Projects Setup",
            icon: "$(repo-clone)",
        });
    });
});

describe("Install Skills manifest contribution", () => {
    it("uses the action-first plural command title", () => {
        expect(manifest.contributes.commands).toContainEqual({
            command: "superset.skillInstall",
            title: "Superset: Install Skills",
            icon: "$(add)",
        });
    });
});

describe("SCM Graph manifest contributions", () => {
    it("declares the proposed Source Control history-item menu API", () => {
        expect(manifest.enabledApiProposals).toContain(
            "contribSourceControlHistoryItemMenu"
        );
    });

    it("places reset commands directly in the single-commit modify group", () => {
        expect(
            manifest.contributes.menus["scm/historyItem/context"]
        ).toEqual([
            {
                command: "superset.gitResetSoft",
                when: "scmProvider == git && !listMultiSelection",
                group: "4_modify@2",
            },
            {
                command: "superset.gitResetHard",
                when: "scmProvider == git && !listMultiSelection",
                group: "4_modify@3",
            },
        ]);
    });

    it("does not leave SCM menu ids at the wrong contributes level", () => {
        expect(
            manifest.contributes["scm/historyItem/context"]
        ).toBeUndefined();
        expect(
            manifest.contributes["scm/graph/context"]
        ).toBeUndefined();
    });
});

describe("Overall TODO manifest contributions", () => {
    it("registers Workspace TODO before Projects TODO", () => {
        expect(manifest.contributes.views["superset-overall"]).toEqual([
            {
                id: "superset.workspaceTodo",
                name: "Workspace TODO",
                contextualTitle: "Overall",
                visibility: "visible",
            },
            {
                id: "superset.projectsTodo",
                name: "Projects TODO",
                contextualTitle: "Overall",
                visibility: "visible",
            },
        ]);
    });
});

describe("Superset view layout manifest contributions", () => {
    it("declares the requested initial visibility and relative size for every view", () => {
        expect(manifest.contributes.views.superset).toEqual([
            {
                id: "superset.terminals",
                name: "Terminals",
                contextualTitle: "SuperSet",
                visibility: "visible",
                initialSize: 1,
            },
            {
                id: "superset.mdns",
                name: "MDNS",
                contextualTitle: "SuperSet",
                visibility: "collapsed",
                initialSize: 3,
            },
            {
                id: "superset.topology",
                name: "Topology",
                contextualTitle: "SuperSet",
                visibility: "collapsed",
                initialSize: 3,
            },
            {
                id: "superset.sessions",
                name: "Sessions",
                contextualTitle: "SuperSet",
                visibility: "collapsed",
                initialSize: 3,
            },
            {
                id: "superset.todo",
                name: "TODO",
                contextualTitle: "SuperSet",
                visibility: "visible",
                initialSize: 4,
            },
        ]);
    });
});

describe("CLI Launcher manifest contributions", () => {
    interface ManifestConfigBlock {
        readonly title: string;
        readonly properties: Record<string, Record<string, unknown>>;
    }

    const VIEW_ID = "superset.cliLauncher.paths";
    const titles = new Map(
        manifest.contributes.commands.map((c) => [c.command, c.title])
    );

    it("gives the panel its own activity-bar container backed by a pkg/resources icon", () => {
        const containers = manifest.contributes.viewsContainers as {
            activitybar: { id: string; title: string; icon: string }[];
        };
        expect(containers.activitybar).toContainEqual({
            id: "cli",
            title: "CLI",
            icon: "pkg/resources/cli.svg",
        });
        expect(manifest.contributes.views.cli).toEqual([
            { id: VIEW_ID, name: "Paths", contextualTitle: "CLI" },
        ]);
    });

    it("publishes one command per agent button plus the path-list commands", () => {
        expect(titles.get("superset.cliLauncherRunClaude")).toBe(
            "Open with Claude"
        );
        expect(titles.get("superset.cliLauncherRunCodex")).toBe(
            "Open with Codex"
        );
        expect(titles.get("superset.cliLauncherRunGrok")).toBe("Open with Grok");
        expect(titles.get("superset.cliLauncherOpen")).toBe(
            "Open Terminal at Path"
        );
        expect(titles.get("superset.cliLauncherAddPath")).toBe("Pin Path");
        expect(titles.get("superset.cliLauncherRemovePath")).toBe("Unpin Path");
        expect(titles.get("superset.cliLauncherCopyAllPaths")).toBe(
            "Copy All Paths"
        );
        expect(titles.get("superset.cliLauncherRefresh")).toBe("Refresh");
        expect(titles.get("superset.cliLauncherFilter")).toBe("Filter Paths");
        expect(titles.get("superset.cliLauncherClearFilter")).toBe(
            "Clear Filter"
        );
    });

    it("shows Clear Filter in the title bar only while a filter is active", () => {
        const titleMenu = manifest.contributes.menus["view/title"].filter(
            (m) => m.command?.startsWith("superset.cliLauncher")
        );
        const filter = titleMenu.find(
            (m) => m.command === "superset.cliLauncherFilter"
        );
        expect(filter?.when).toBe(`view == ${VIEW_ID}`);

        const clear = titleMenu.find(
            (m) => m.command === "superset.cliLauncherClearFilter"
        );
        expect(clear?.when).toBe(
            `view == ${VIEW_ID} && superset.cliLauncher.filtered == true`
        );
    });

    it("keeps no command under the pre-move cliLauncher.* namespace", () => {
        for (const command of manifest.contributes.commands) {
            expect(command.command.startsWith("cliLauncher.")).toBe(false);
        }
    });

    it("binds ctrl+1/2/3 only while the CLI panel has focus", () => {
        interface ManifestKeybinding {
            readonly command: string;
            readonly key: string;
            readonly when?: string;
        }
        const keybindings = manifest.contributes
            .keybindings as ManifestKeybinding[];
        // Unscoped these would shadow VS Code's own "switch editor group".
        for (const [key, command] of [
            ["ctrl+1", "superset.cliLauncherRunClaude"],
            ["ctrl+2", "superset.cliLauncherRunCodex"],
            ["ctrl+3", "superset.cliLauncherRunGrok"],
        ]) {
            const binding = keybindings.find((k) => k.command === command);
            expect(binding?.key).toBe(key);
            expect(binding?.when).toBe(`focusedView == ${VIEW_ID}`);
        }
    });

    it("shows the three agent buttons inline on every row kind", () => {
        const rowKinds =
            "viewItem == superset.cliLauncher.entry || viewItem == superset.cliLauncher.folder";
        const inline = manifest.contributes.menus["view/item/context"].filter(
            (m) => m.command?.startsWith("superset.cliLauncherRun")
        );
        expect(inline.map((m) => m.group)).toEqual([
            "inline@1",
            "inline@2",
            "inline@3",
        ]);
        for (const item of inline) {
            expect(item.when).toBe(`view == ${VIEW_ID} && (${rowKinds})`);
        }

        // Unpin is pinned-only — scanned folders are removed by editing roots.
        const unpin = manifest.contributes.menus["view/item/context"].find(
            (m) => m.command === "superset.cliLauncherRemovePath"
        );
        expect(unpin?.when).toBe(
            `view == ${VIEW_ID} && viewItem == superset.cliLauncher.entry`
        );
    });

    it("declares the three application-scoped settings", () => {
        const configuration = manifest.contributes
            .configuration as ManifestConfigBlock[];
        const block = configuration.find(
            (b) => b.title === "Superset CLI Launcher"
        );
        expect(block).toBeDefined();
        expect(Object.keys(block!.properties).sort()).toEqual([
            "superset.cliLauncher.agentCommands",
            "superset.cliLauncher.entries",
            "superset.cliLauncher.roots",
        ]);
        // Path lists are system-level, not per-workspace.
        for (const property of Object.values(block!.properties)) {
            expect(property.scope).toBe("application");
        }
        expect(block!.properties["superset.cliLauncher.roots"].default).toEqual(
            ["~/projects"]
        );
    });
});

describe("Sessions manifest contributions", () => {
    it("exposes Open Session Source File inline and in the open group", () => {
        expect(manifest.contributes.commands).toContainEqual({
            command: "superset.sessionsOpenSource",
            title: "Open Session Source File",
            icon: "$(edit)",
        });

        const items = manifest.contributes.menus["view/item/context"].filter(
            (m) => m.command === "superset.sessionsOpenSource"
        );
        // Inline gives the hover button; the named group gives the
        // right-click entry. Both are needed — inline alone is invisible to
        // keyboard-only navigation of the context menu.
        expect(items.map((m) => m.group).sort()).toEqual(["1_open", "inline"]);
        for (const item of items) {
            expect(item.when).toBe("viewItem == supersetSession");
        }
    });
});

describe("Explorer GitHub URL manifest contribution", () => {
    it("adds Copy GitHub URL to the Explorer copy-path group", () => {
        expect(manifest.contributes.commands).toContainEqual({
            command: "superset.copyGitHubUrl",
            title: "Copy GitHub URL",
            icon: "$(github)",
        });
        expect(
            manifest.contributes.menus["explorer/context"]
        ).toContainEqual({
            command: "superset.copyGitHubUrl",
            when: "resourceScheme == file && !explorerResourceIsRoot",
            group: "6_copypath@100",
        });
    });
});

describe("Editor Layout manifest contributions", () => {
    interface ManifestKeybinding {
        readonly command: string;
        readonly key: string;
        readonly when?: string;
    }
    interface ManifestConfigBlock {
        readonly title: string;
        readonly properties: Record<string, Record<string, unknown>>;
    }

    const keybindings = manifest.contributes
        .keybindings as ManifestKeybinding[];
    const configuration = manifest.contributes
        .configuration as ManifestConfigBlock[];
    const layoutConfig = configuration.find(
        (block) => block.title === "Superset Editor Layout"
    );
    const titles = new Map(
        manifest.contributes.commands.map((c) => [c.command, c.title])
    );

    it("publishes one command per sizing combination, naming both directions", () => {
        // A mode is {horizontal} x {vertical}; a title that named only
        // one direction would hide half the state it selects.
        expect(titles.get("superset.editorLayoutEven")).toBe(
            "Superset: Editor Layout — Even Both Directions"
        );
        expect(titles.get("superset.editorLayoutMaxHorizontal")).toBe(
            "Superset: Editor Layout — Max Horizontal, Even Vertical"
        );
        expect(titles.get("superset.editorLayoutMaxVertical")).toBe(
            "Superset: Editor Layout — Even Horizontal, Max Vertical"
        );
        expect(titles.get("superset.editorLayoutMaxBoth")).toBe(
            "Superset: Editor Layout — Max Both Directions"
        );
    });

    it("publishes the per-direction toggles, transpose and pickers", () => {
        expect(titles.get("superset.editorLayoutToggleHorizontal")).toBe(
            "Superset: Toggle Horizontal Editor Sizing"
        );
        expect(titles.get("superset.editorLayoutToggleVertical")).toBe(
            "Superset: Toggle Vertical Editor Sizing"
        );
        expect(titles.get("superset.editorLayoutTranspose")).toBe(
            "Superset: Transpose Editor Grid"
        );
        expect(titles.get("superset.editorLayoutCycle")).toBe(
            "Superset: Cycle Editor Layout Mode"
        );
        expect(titles.get("superset.editorLayoutPick")).toBe(
            "Superset: Pick Editor Layout Mode"
        );
        expect(titles.get("superset.editorLayoutShapePick")).toBe(
            "Superset: Pick Editor Grid Shape"
        );
        expect(titles.get("superset.editorLayoutShapeReset")).toBe(
            "Superset: Reset Editor Grid Shape"
        );
    });

    it("does not keep any superseded single-axis command", () => {
        for (const stale of [
            "superset.editorLayoutHorizontalEven",
            "superset.editorLayoutHorizontalMax",
            "superset.editorLayoutVerticalEven",
            "superset.editorLayoutVerticalMax",
            "superset.editorLayoutToggleAxis",
            "superset.editorLayoutToggleSizing",
        ]) {
            expect(titles.has(stale), stale).toBe(false);
        }
    });

    it("binds cycle and pick only while an editor is open", () => {
        const cycle = keybindings.find(
            (k) => k.command === "superset.editorLayoutCycle"
        );
        const pick = keybindings.find(
            (k) => k.command === "superset.editorLayoutPick"
        );
        expect(cycle?.key).toBe("cmd+alt+v");
        expect(cycle?.mac).toBe("cmd+alt+v");
        expect(cycle?.when).toBe("editorIsOpen");
        expect(pick?.key).toBe("ctrl+alt+shift+v");
        expect(pick?.when).toBe("editorIsOpen");
    });

    it("does not turn a bound key into a chord leader", () => {
        // VS Code rejects a keybinding that is both a standalone
        // command and the prefix of a chord.
        const chords = keybindings.filter((k) => k.key.includes(" "));
        expect(chords).toEqual([]);
    });

    it("declares the four settings with their bounds", () => {
        expect(layoutConfig).toBeDefined();
        const props = layoutConfig!.properties;
        expect(Object.keys(props).sort()).toEqual([
            "superset.editorLayout.defaultShape",
            "superset.editorLayout.followActiveGroup",
            "superset.editorLayout.maxRatio",
            "superset.editorLayout.restoreOnActivate",
        ]);

        const ratio = props["superset.editorLayout.maxRatio"];
        expect(ratio.type).toBe("number");
        expect(ratio.default).toBe(0.8);
        expect(ratio.minimum).toBe(0.5);
        expect(ratio.maximum).toBe(0.9);

        const shape = props["superset.editorLayout.defaultShape"];
        expect(shape.enum).toEqual(["flat", "balanced"]);
        expect(shape.default).toBe("flat");

        expect(props["superset.editorLayout.followActiveGroup"].default).toBe(
            true
        );
        expect(props["superset.editorLayout.restoreOnActivate"].default).toBe(
            true
        );
    });
});
