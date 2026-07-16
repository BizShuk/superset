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

interface SupersetManifest {
    readonly enabledApiProposals?: string[];
    readonly contributes: {
        readonly commands: ManifestCommand[];
        readonly menus: Record<string, ManifestMenuItem[]>;
        readonly [key: string]: unknown;
    };
}

const manifestPath = fileURLToPath(
    new URL("../package.json", import.meta.url)
);
const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8")
) as SupersetManifest;

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
