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
