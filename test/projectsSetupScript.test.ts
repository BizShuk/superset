import { spawnSync } from "node:child_process";
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPOSITORIES = [
    "bizshuk/env_setup",
    "bizshuk/cc-plugin",
    "bizshuk/ai",
    "bizshuk/game",
    "bizshuk/data",
    "bizshuk/iphone",
    "bizshuk/platform",
    "bizshuk/playground",
    "bizshuk/product",
    "bizshuk/research",
    "bizshuk/tools",
    "bizshuk/web",
] as const;

const SCRIPT = path.join(
    __dirname,
    "..",
    "pkg",
    "resources",
    "config",
    "setup-projects.sh"
);

describe("setup-projects.sh", () => {
    let scratchDir: string;
    let fakeBinDir: string;
    let gitLogPath: string;

    beforeEach(() => {
        scratchDir = mkdtempSync(path.join(os.tmpdir(), "superset-projects-"));
        fakeBinDir = path.join(scratchDir, "bin");
        gitLogPath = path.join(scratchDir, "git.log");
        mkdirSync(fakeBinDir);

        const fakeGitPath = path.join(fakeBinDir, "git");
        writeFileSync(
            fakeGitPath,
            `#!/usr/bin/env bash
{
    for arg in "$@"; do
        printf '<%s>' "$arg"
    done
    printf '\\n'
} >> "$FAKE_GIT_LOG"

if [[ "$1" == "clone" ]]; then
    clone_target=""
    for arg in "$@"; do
        clone_target="$arg"
    done
    mkdir -p "$clone_target/.git"
fi
`,
            "utf8"
        );
        chmodSync(fakeGitPath, 0o755);
    });

    afterEach(() => {
        rmSync(scratchDir, { recursive: true, force: true });
    });

    function runSetup(projectsRoot: string) {
        return spawnSync("bash", [SCRIPT, projectsRoot], {
            encoding: "utf8",
            env: {
                ...process.env,
                PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
                FAKE_GIT_LOG: gitLogPath,
            },
        });
    }

    function gitLogLines(): string[] {
        return readFileSync(gitLogPath, "utf8").trim().split("\n");
    }

    it("creates a missing projects root and clones every repository with recursive submodules", () => {
        const projectsRoot = path.join(scratchDir, "projects root");

        const result = runSetup(projectsRoot);

        expect(result.status, result.stderr).toBe(0);
        expect(gitLogLines()).toEqual(
            REPOSITORIES.map((repository) => {
                const name = repository.slice(repository.indexOf("/") + 1);
                return `<clone><--recurse-submodules><https://github.com/${repository}.git><${path.join(
                    projectsRoot,
                    name
                )}>`;
            })
        );
        expect(result.stdout).toContain(
            `Projects setup complete: ${projectsRoot}`
        );
    });

    it("initializes recursive submodules without cloning repositories that already exist", () => {
        const projectsRoot = path.join(scratchDir, "projects");
        for (const repository of REPOSITORIES) {
            const name = repository.slice(repository.indexOf("/") + 1);
            mkdirSync(path.join(projectsRoot, name, ".git"), {
                recursive: true,
            });
        }

        const result = runSetup(projectsRoot);

        expect(result.status, result.stderr).toBe(0);
        expect(gitLogLines()).toEqual(
            REPOSITORIES.flatMap((repository) => {
                const name = repository.slice(repository.indexOf("/") + 1);
                const target = path.join(projectsRoot, name);
                return [
                    `<-C><${target}><submodule><sync><--recursive>`,
                    `<-C><${target}><submodule><update><--init><--recursive>`,
                ];
            })
        );
    });

    it("reports a non-Git path conflict but continues setting up the other repositories", () => {
        const projectsRoot = path.join(scratchDir, "projects");
        mkdirSync(path.join(projectsRoot, "env_setup"), { recursive: true });

        const result = runSetup(projectsRoot);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
            "target exists but is not a Git repository"
        );
        expect(gitLogLines()).toHaveLength(REPOSITORIES.length - 1);
        expect(result.stdout).toContain("[ready]  bizshuk/web");
    });
});
