import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
    filterRepositoryFolders,
    hasOwnGitMarker,
} from "../src/cliLauncher/repositoryDiscovery";
import type { CLIEntry } from "../src/cliLauncher/entries";
import type { ScannedFolder } from "../src/cliLauncher/scan";

function entry(target: string): CLIEntry {
    return {
        id: target,
        label: path.basename(target),
        path: target,
    };
}

describe("CLI Launcher repository discovery", () => {
    let root = "";

    beforeAll(async () => {
        root = await fs.mkdtemp(
            path.join(os.tmpdir(), "cli-launcher-repositories-")
        );

        await fs.mkdir(path.join(root, "top-repo/.git"), {
            recursive: true,
        });
        await fs.mkdir(path.join(root, "top-repo/plain-child"), {
            recursive: true,
        });
        await fs.mkdir(path.join(root, "top-repo/worktree-child"), {
            recursive: true,
        });
        await fs.writeFile(
            path.join(root, "top-repo/worktree-child/.git"),
            "gitdir: /tmp/example\n"
        );

        await fs.mkdir(path.join(root, "category/repo-child/.git"), {
            recursive: true,
        });
        await fs.mkdir(path.join(root, "category/plain-child"), {
            recursive: true,
        });
        await fs.mkdir(path.join(root, "plain-top/plain-child"), {
            recursive: true,
        });
    });

    afterAll(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it("recognizes only a folder's own .git directory or file", async () => {
        expect(await hasOwnGitMarker(path.join(root, "top-repo"))).toBe(true);
        expect(
            await hasOwnGitMarker(
                path.join(root, "top-repo/worktree-child")
            )
        ).toBe(true);
        expect(
            await hasOwnGitMarker(path.join(root, "top-repo/plain-child"))
        ).toBe(false);
        expect(await hasOwnGitMarker(path.join(root, "missing"))).toBe(false);
    });

    it("keeps repositories and only the category containers needed to reach them", async () => {
        const folders: ScannedFolder[] = [
            {
                entry: entry(path.join(root, "top-repo")),
                children: [
                    entry(path.join(root, "top-repo/plain-child")),
                    entry(path.join(root, "top-repo/worktree-child")),
                ],
            },
            {
                entry: entry(path.join(root, "category")),
                children: [
                    entry(path.join(root, "category/repo-child")),
                    entry(path.join(root, "category/plain-child")),
                ],
            },
            {
                entry: entry(path.join(root, "plain-top")),
                children: [entry(path.join(root, "plain-top/plain-child"))],
            },
            {
                entry: entry(path.join(root, "missing")),
                children: [],
            },
        ];

        const filtered = await filterRepositoryFolders(folders);

        expect(filtered.map((folder) => folder.entry.label)).toEqual([
            "top-repo",
            "category",
        ]);
        expect(filtered[0].children.map((child) => child.label)).toEqual([
            "worktree-child",
        ]);
        expect(filtered[1].children.map((child) => child.label)).toEqual([
            "repo-child",
        ]);
    });

    it("limits concurrent repository probes", async () => {
        const folders: ScannedFolder[] = Array.from(
            { length: 20 },
            (_, index) => ({
                entry: entry(path.join(root, `candidate-${index}`)),
                children: [],
            })
        );
        let active = 0;
        let peak = 0;

        await filterRepositoryFolders(folders, async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            return true;
        });

        expect(peak).toBeLessThanOrEqual(8);
        expect(peak).toBeGreaterThan(1);
    });
});
