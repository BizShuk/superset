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
    readonly type?: string;
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

describe("Removed SCM Graph reset", () => {
    it("declares no Proposed API", () => {
        expect(manifest.enabledApiProposals).toBeUndefined();
    });

    it("declares neither reset commands nor a history-item menu", () => {
        const commandIDs = manifest.contributes.commands.map(
            (command) => command.command
        );
        expect(commandIDs).not.toContain("superset.gitResetSoft");
        expect(commandIDs).not.toContain("superset.gitResetHard");
        expect(
            manifest.contributes.menus["scm/historyItem/context"]
        ).toBeUndefined();
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

describe("Removed Overall panel", () => {
    it("declares neither the Overall view container nor its views", () => {
        expect(manifest.contributes.views["superset-overall"]).toBeUndefined();
        expect(
            manifest.contributes.viewsContainers.activitybar.map(
                (c: { id: string }) => c.id
            )
        ).toEqual(["superset", "cli"]);
    });

    it("declares no superset.projectsTodo* command or menu entry", () => {
        const commandIds = manifest.contributes.commands.map(
            (c: { command: string }) => c.command
        );
        expect(
            commandIds.filter((id: string) =>
                id.startsWith("superset.projectsTodo")
            )
        ).toEqual([]);
        expect(commandIds).not.toContain("superset.focusOverallView");

        const menuEntries = Object.values(
            manifest.contributes.menus as Record<
                string,
                Array<{ command: string; when?: string }>
            >
        ).flat();
        for (const entry of menuEntries) {
            expect(entry.command.startsWith("superset.projectsTodo")).toBe(
                false
            );
            expect(entry.when ?? "").not.toContain("projectsTodo");
        }
    });

    it("keeps superset.openProject wired to the surviving TODO rows", () => {
        const openProjectEntries = (
            manifest.contributes.menus["view/item/context"] as Array<{
                command: string;
                when?: string;
            }>
        ).filter((e) => e.command === "superset.openProject");
        expect(openProjectEntries.map((e) => e.when)).toEqual([
            "viewItem == todoPlan",
            "viewItem == todoProject",
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
            icon: "pkg/resources/cli.png",
        });
        expect(manifest.contributes.views.cli).toEqual([
            { id: VIEW_ID, name: "Repo Path", contextualTitle: "CLI" },
            {
                id: "superset.cliLauncher.changes",
                name: "Change",
                contextualTitle: "CLI",
            },
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
        expect(titles.get("superset.cliLauncherOpenNewWindow")).toBe(
            "Open in New Window"
        );
        expect(titles.get("superset.cliLauncherCreateSubfolder")).toBe(
            "Create Subfolder"
        );
        expect(titles.get("superset.cliLauncherAddPath")).toBe("Pin Path");
        expect(titles.get("superset.cliLauncherAddPathToFocus")).toBe(
            "Add to Focus List"
        );
        expect(titles.get("superset.cliLauncherRemovePathFromFocus")).toBe(
            "Remove from Focus List"
        );
        expect(titles.get("superset.cliLauncherShowFocusedOnly")).toBe(
            "Show Focused Paths Only"
        );
        expect(titles.get("superset.cliLauncherShowAllPaths")).toBe(
            "Show All Paths"
        );
        expect(titles.get("superset.cliLauncherRemovePath")).toBe(
            "Remove from Panel"
        );
        expect(titles.get("superset.cliLauncherRestoreHidden")).toBe(
            "Restore Hidden Paths"
        );
        expect(titles.get("superset.cliLauncherCopyAllPaths")).toBe(
            "Copy All Paths"
        );
        expect(titles.get("superset.cliLauncherRefresh")).toBe("Refresh");
        expect(titles.get("superset.cliLauncherFilter")).toBe("Filter Paths");
        expect(titles.get("superset.cliLauncherStageChanges")).toBe(
            "Stage Changes"
        );
        expect(titles.get("superset.cliLauncherUnstageChanges")).toBe(
            "Unstage Changes"
        );
        expect(titles.get("superset.cliLauncherDiscardChanges")).toBe(
            "Discard Changes"
        );
        expect(titles.has("superset.cliLauncherOpenSourceControl")).toBe(false);
        expect(titles.has("superset.cliLauncherCommitStaged")).toBe(false);
        expect(titles.has("superset.cliLauncherGenerateCommitMessage")).toBe(
            false
        );
        expect(titles.has("superset.cliLauncherClearFilter")).toBe(false);

    });

    it("offers one native Filter action in the CLI title bar", () => {
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
        expect(clear).toBeUndefined();
    });

    it("offers one persistent Focus toggle in the CLI title bar", () => {
        const titleMenu = manifest.contributes.menus["view/title"];
        expect(titleMenu).toContainEqual({
            command: "superset.cliLauncherShowFocusedOnly",
            when: `view == ${VIEW_ID} && config.superset.cliLauncher.focusedOnly != true`,
            group: "navigation@2",
        });
        expect(titleMenu).toContainEqual({
            command: "superset.cliLauncherShowAllPaths",
            when: `view == ${VIEW_ID} && config.superset.cliLauncher.focusedOnly == true`,
            group: "navigation@2",
        });
    });

    it("offers Refresh from both Repo Path and Change views", () => {
        const refreshEntries = manifest.contributes.menus["view/title"].filter(
            (item) => item.command === "superset.cliLauncherRefresh"
        );
        expect(refreshEntries).toEqual([
            {
                command: "superset.cliLauncherRefresh",
                when: `view == ${VIEW_ID}`,
                group: "navigation@5",
            },
            {
                command: "superset.cliLauncherRefresh",
                when: "view == superset.cliLauncher.changes",
                group: "navigation@1",
            },
        ]);
    });

    it("uses native Change title and inline actions", () => {
        const titleMenu = manifest.contributes.menus["view/title"].filter(
            (item) => item.when === "view == superset.cliLauncher.changes"
        );
        expect(titleMenu).toEqual([
            {
                command: "superset.cliLauncherRefresh",
                when: "view == superset.cliLauncher.changes",
                group: "navigation@1",
            },
        ]);

        const inline = manifest.contributes.menus["view/item/context"].filter(
            (item) =>
                item.when?.startsWith(
                    "view == superset.cliLauncher.changes &&"
                )
        );
        expect(inline).toEqual([
            {
                command: "superset.cliLauncherDiscardChanges",
                when: "view == superset.cliLauncher.changes && viewItem == superset.cliLauncher.scm.staged",
                group: "inline@1",
            },
            {
                command: "superset.cliLauncherUnstageChanges",
                when: "view == superset.cliLauncher.changes && viewItem == superset.cliLauncher.scm.staged",
                group: "inline@2",
            },
            {
                command: "superset.cliLauncherDiscardChanges",
                when: "view == superset.cliLauncher.changes && viewItem == superset.cliLauncher.scm.unstaged",
                group: "inline@1",
            },
            {
                command: "superset.cliLauncherStageChanges",
                when: "view == superset.cliLauncher.changes && viewItem == superset.cliLauncher.scm.unstaged",
                group: "inline@2",
            },
            {
                command: "superset.cliLauncherDiscardChanges",
                when: "view == superset.cliLauncher.changes && viewItem == superset.cliLauncher.scm.untracked",
                group: "inline@1",
            },
            {
                command: "superset.cliLauncherStageChanges",
                when: "view == superset.cliLauncher.changes && viewItem == superset.cliLauncher.scm.untracked",
                group: "inline@2",
            },
        ]);
    });

    it("keeps no command under the pre-move cliLauncher.* namespace", () => {
        for (const command of manifest.contributes.commands) {
            expect(command.command.startsWith("cliLauncher.")).toBe(false);
        }
    });

    it("binds CLI hotkeys only while the panel has a path selection", () => {
        interface ManifestKeybinding {
            readonly command: string;
            readonly key: string;
            readonly when?: string;
        }
        const keybindings = manifest.contributes
            .keybindings as ManifestKeybinding[];
        const cliCommands = [
            "superset.cliLauncherOpenNewWindow",
            "superset.cliLauncherOpen",
            "superset.cliLauncherRunClaude",
            "superset.cliLauncherRunCodex",
            "superset.cliLauncherRunGrok",
        ];
        const when = `focusedView == ${VIEW_ID} && superset.cliLauncher.hasPathSelection && !inputFocus`;

        expect(
            keybindings.filter((binding) =>
                cliCommands.includes(binding.command)
            )
        ).toEqual([
            {
                command: "superset.cliLauncherOpenNewWindow",
                key: "cmd+n",
                when,
            },
            {
                command: "superset.cliLauncherOpen",
                key: "ctrl+1",
                when,
            },
            {
                command: "superset.cliLauncherRunClaude",
                key: "ctrl+2",
                when,
            },
            {
                command: "superset.cliLauncherRunCodex",
                key: "ctrl+3",
                when,
            },
            {
                command: "superset.cliLauncherRunGrok",
                key: "ctrl+4",
                when,
            },
        ]);
    });

    it("binds cmd+f to filtering only while the CLI panel itself has focus", () => {
        interface ManifestKeybinding {
            readonly command: string;
            readonly key: string;
            readonly when?: string;
        }
        const keybindings = manifest.contributes
            .keybindings as ManifestKeybinding[];
        const binding = keybindings.find(
            (item) => item.command === "superset.cliLauncherFilter"
        );

        expect(binding?.key).toBe("cmd+f");
        expect(binding?.when).toBe(
            `focusedView == ${VIEW_ID} && !inputFocus`
        );
    });

    it("shows the three agent buttons inline on every row kind", () => {
        const unfocusedRowKinds =
            "viewItem == superset.cliLauncher.entry || viewItem == superset.cliLauncher.folder";
        const focusedRowKinds =
            "viewItem == superset.cliLauncher.entry.focused || viewItem == superset.cliLauncher.folder.focused";
        const rowKinds = `${unfocusedRowKinds} || ${focusedRowKinds}`;
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

        // Remove works on both row kinds: pinned rows unpin, scanned rows go
        // into superset.cliLauncher.hidden. A two-layer scan always turns up
        // folders the user does not want listed.
        const remove = manifest.contributes.menus["view/item/context"].find(
            (m) => m.command === "superset.cliLauncherRemovePath"
        );
        expect(remove?.when).toBe(`view == ${VIEW_ID} && (${rowKinds})`);
        expect(remove?.group).toBe("2_modify@3");

        const createSubfolder = manifest.contributes.menus[
            "view/item/context"
        ].find(
            (item) =>
                item.command === "superset.cliLauncherCreateSubfolder"
        );
        expect(createSubfolder).toEqual({
            command: "superset.cliLauncherCreateSubfolder",
            when: `view == ${VIEW_ID} && (${rowKinds})`,
            group: "2_modify@1",
        });

        const addFocus = manifest.contributes.menus[
            "view/item/context"
        ].find(
            (item) =>
                item.command === "superset.cliLauncherAddPathToFocus"
        );
        expect(addFocus).toEqual({
            command: "superset.cliLauncherAddPathToFocus",
            when: `view == ${VIEW_ID} && (${unfocusedRowKinds})`,
            group: "2_modify@2",
        });

        const removeFocus = manifest.contributes.menus[
            "view/item/context"
        ].find(
            (item) =>
                item.command === "superset.cliLauncherRemovePathFromFocus"
        );
        expect(removeFocus).toEqual({
            command: "superset.cliLauncherRemovePathFromFocus",
            when: `view == ${VIEW_ID} && (${focusedRowKinds})`,
            group: "2_modify@2",
        });

        const openNewWindow = manifest.contributes.menus[
            "view/item/context"
        ].find(
            (m) => m.command === "superset.cliLauncherOpenNewWindow"
        );
        expect(openNewWindow).toEqual({
            command: "superset.cliLauncherOpenNewWindow",
            when: `view == ${VIEW_ID} && (${rowKinds})`,
            group: "1_run@2",
        });

        // Restore is the way back — without it, removing means hand-editing
        // settings.
        const restore = manifest.contributes.menus["view/title"].find(
            (m) => m.command === "superset.cliLauncherRestoreHidden"
        );
        expect(restore?.when).toBe(`view == ${VIEW_ID}`);
    });

    it("declares the six application-scoped settings", () => {
        const configuration = manifest.contributes
            .configuration as ManifestConfigBlock[];
        const block = configuration.find(
            (b) => b.title === "Superset CLI Launcher"
        );
        expect(block).toBeDefined();
        expect(Object.keys(block!.properties).sort()).toEqual([
            "superset.cliLauncher.agentCommands",
            "superset.cliLauncher.entries",
            "superset.cliLauncher.focused",
            "superset.cliLauncher.focusedOnly",
            "superset.cliLauncher.hidden",
            "superset.cliLauncher.roots",
        ]);
        // Path lists are system-level, not per-workspace.
        for (const property of Object.values(block!.properties)) {
            expect(property.scope).toBe("application");
        }
        expect(block!.properties["superset.cliLauncher.roots"].default).toEqual(
            ["~/projects"]
        );

        const entries = block!.properties["superset.cliLauncher.entries"] as {
            items?: { oneOf?: Array<{ required?: string[] }> };
            markdownDescription?: string;
        };
        const roots = block!.properties["superset.cliLauncher.roots"] as {
            markdownDescription?: string;
        };
        const hidden = block!.properties["superset.cliLauncher.hidden"] as {
            items?: { oneOf?: Array<{ required?: string[] }> };
            markdownDescription?: string;
        };
        const focused = block!.properties["superset.cliLauncher.focused"] as {
            type?: string;
            default?: unknown;
            items?: { type?: string };
            markdownDescription?: string;
        };
        const focusedOnly = block!.properties[
            "superset.cliLauncher.focusedOnly"
        ] as {
            type?: string;
            default?: unknown;
            markdownDescription?: string;
        };
        expect(entries.items?.oneOf).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ required: ["path"] }),
                expect.objectContaining({ required: ["regex"] }),
            ])
        );
        expect(hidden.items?.oneOf).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ required: ["regex"] }),
            ])
        );
        expect(entries.markdownDescription).toContain("Regex");
        expect(entries.markdownDescription).toContain("non-repository");
        expect(roots.markdownDescription).toContain("Git repositories");
        expect(hidden.markdownDescription).toContain("Regex");
        expect(focused).toEqual(
            expect.objectContaining({
                type: "array",
                scope: "application",
                default: [],
                items: { type: "string" },
            })
        );
        expect(focused.markdownDescription).toContain("exact paths");
        expect(focusedOnly).toEqual(
            expect.objectContaining({
                type: "boolean",
                scope: "application",
                default: false,
            })
        );
        expect(focusedOnly.markdownDescription).toContain("ancestor category");
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

    it("publishes only the four commands the feature still owns", () => {
        expect(titles.get("superset.editorLayoutRefresh")).toBe(
            "Superset: Refresh Editor Layout"
        );
        expect(titles.get("superset.editorLayoutTranspose")).toBe(
            "Superset: Transpose Editor Grid"
        );
        expect(titles.get("superset.editorLayoutShapePick")).toBe(
            "Superset: Pick Editor Grid Shape"
        );
        expect(titles.get("superset.editorLayoutShapeReset")).toBe(
            "Superset: Reset Editor Grid Shape"
        );
        expect(
            [...titles.keys()].filter((c) => c.startsWith("superset.editorLayout"))
        ).toHaveLength(4);
    });

    it("keeps no mode-selection command", () => {
        // The sizing rule is fixed (horizontal even, vertical max), so
        // every command that used to SELECT one is gone — along with
        // the superseded single-axis ids from before that.
        for (const stale of [
            "superset.editorLayoutEven",
            "superset.editorLayoutMaxHorizontal",
            "superset.editorLayoutMaxVertical",
            "superset.editorLayoutMaxBoth",
            "superset.editorLayoutToggleHorizontal",
            "superset.editorLayoutToggleVertical",
            "superset.editorLayoutCycle",
            "superset.editorLayoutPick",
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

    it("binds refresh, and only refresh, while an editor is open", () => {
        const layoutKeys = keybindings.filter((k) =>
            k.command.startsWith("superset.editorLayout")
        );
        expect(layoutKeys).toHaveLength(1);
        expect(layoutKeys[0].command).toBe("superset.editorLayoutRefresh");
        expect(layoutKeys[0].key).toBe("cmd+alt+v");
        expect(layoutKeys[0].when).toBe("editorIsOpen");
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
