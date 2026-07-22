import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const hookPath = path.resolve(
    process.cwd(),
    "pkg/resources/git/githooks/pre-push"
);
const roots: string[] = [];
const zeroSha = "0".repeat(40);

interface FixtureVersions {
    tags: string[];
    packageVersion?: string;
    pluginVersion?: string;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim();
}

async function createFixture(versions: FixtureVersions): Promise<{
    remote: string;
    repo: string;
    sha: string;
}> {
    const root = await mkdtemp(path.join(tmpdir(), "superset-pre-push-"));
    roots.push(root);
    const remote = path.join(root, "remote.git");
    const repo = path.join(root, "repo");

    await mkdir(repo);
    await git(root, "init", "--bare", remote);
    await git(repo, "init");
    await git(repo, "checkout", "-B", "master");
    await git(repo, "config", "user.name", "Superset Test");
    await git(repo, "config", "user.email", "superset@example.invalid");
    await git(repo, "config", "commit.gpgSign", "false");
    await git(repo, "config", "tag.gpgSign", "false");
    await git(repo, "remote", "add", "origin", remote);
    await writeFile(path.join(repo, "README.md"), "fixture\n");

    if (versions.packageVersion) {
        await writeFile(
            path.join(repo, "package.json"),
            `${JSON.stringify({ version: versions.packageVersion }, null, 2)}\n`
        );
    }
    if (versions.pluginVersion) {
        const pluginDir = path.join(repo, ".claude-plugin");
        await mkdir(pluginDir);
        await writeFile(
            path.join(pluginDir, "plugin.json"),
            `${JSON.stringify({ version: versions.pluginVersion }, null, 2)}\n`
        );
    }

    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "fixture");
    for (const tag of versions.tags) {
        await git(repo, "tag", tag);
    }

    return { remote, repo, sha: await git(repo, "rev-parse", "HEAD") };
}

async function runPrePush(
    repo: string,
    remote: string,
    sha: string
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(hookPath, ["origin", remote], {
            cwd: repo,
            stdio: ["pipe", "ignore", "pipe"],
        });
        let stderr = "";

        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve(stderr);
                return;
            }
            reject(new Error(`pre-push exited ${code}: ${stderr}`));
        });
        child.stdin.end(
            `refs/heads/master ${sha} refs/heads/master ${zeroSha}\n`
        );
    });
}

afterEach(async () => {
    await Promise.all(
        roots.splice(0).map((root) =>
            rm(root, { recursive: true, force: true })
        )
    );
});

describe("pre-push release version selection", () => {
    it.each([
        {
            name: "increments the highest Git tag when manifests are absent",
            versions: { tags: ["v1.9.9", "v1.10.0"] },
            expected: "v1.10.1",
        },
        {
            name: "keeps the next Git patch when package.json is lower",
            versions: {
                tags: ["v2.3.4"],
                packageVersion: "2.3.4",
            },
            expected: "v2.3.5",
        },
        {
            name: "uses package.json when it is higher than the next Git patch",
            versions: {
                tags: ["v2.3.4"],
                packageVersion: "3.0.0",
            },
            expected: "v3.0.0",
        },
        {
            name: "uses the Claude plugin manifest when it is highest",
            versions: {
                tags: ["v2.3.4"],
                packageVersion: "3.0.0",
                pluginVersion: "3.1.2",
            },
            expected: "v3.1.2",
        },
    ])("$name", async ({ versions, expected }) => {
        const { remote, repo, sha } = await createFixture(versions);

        const stderr = await runPrePush(repo, remote, sha);

        expect(await git(repo, "cat-file", "-t", `refs/tags/${expected}`)).toBe(
            "tag"
        );
        expect(
            await git(remote, "cat-file", "-t", `refs/tags/${expected}`)
        ).toBe("tag");
        expect(stderr).toContain(`建立 tag ${expected}`);
        expect(stderr).toContain(`已推送 ${expected} 至 origin`);
    });
});
