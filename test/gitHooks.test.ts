import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    copyMissingTree,
    hasLocalHooksPath,
    isGitRepository,
    linkGitHooks,
    readLocalHooksPath,
    type GitRunner,
} from "../src/git/gitHooks";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "superset-githooks-"));
    roots.push(root);
    return root;
}

afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(
        roots.splice(0).map((root) =>
            rm(root, { recursive: true, force: true })
        )
    );
});

describe("copyMissingTree", () => {
    it("copies nested missing files and preserves executable mode", async () => {
        const root = await tempRoot();
        const source = path.join(root, "source");
        const target = path.join(root, "target");
        await mkdir(path.join(source, "scripts"), { recursive: true });
        const script = path.join(source, "scripts", "check.sh");
        await writeFile(script, "#!/bin/sh\necho ok\n");
        await chmod(script, 0o755);

        await expect(copyMissingTree(source, target)).resolves.toEqual({
            copied: 1,
            skipped: 0,
        });
        expect(
            await readFile(path.join(target, "scripts", "check.sh"), "utf8")
        ).toBe("#!/bin/sh\necho ok\n");
        const { stat } = await import("node:fs/promises");
        expect(
            (await stat(path.join(target, "scripts", "check.sh"))).mode &
                0o111
        ).toBe(0o111);
    });

    it("keeps existing files and fills only missing siblings", async () => {
        const root = await tempRoot();
        const source = path.join(root, "source");
        const target = path.join(root, "target");
        await mkdir(source, { recursive: true });
        await mkdir(target, { recursive: true });
        await writeFile(path.join(source, "existing"), "template");
        await writeFile(path.join(source, "missing"), "new");
        await writeFile(path.join(target, "existing"), "custom");

        await expect(copyMissingTree(source, target)).resolves.toEqual({
            copied: 1,
            skipped: 1,
        });
        expect(await readFile(path.join(target, "existing"), "utf8")).toBe(
            "custom"
        );
        expect(await readFile(path.join(target, "missing"), "utf8")).toBe(
            "new"
        );
    });
});

function runnerResult(result: string): GitRunner {
    return vi.fn(async () => result);
}

describe("Git hooks config helpers", () => {
    it("recognizes only a successful inside-work-tree response", async () => {
        await expect(
            isGitRepository("/repo", runnerResult("true\n"))
        ).resolves.toBe(true);
        await expect(
            isGitRepository("/repo", runnerResult("false\n"))
        ).resolves.toBe(false);
        const failing = vi.fn(async () => {
            throw new Error("not a repository");
        });
        await expect(isGitRepository("/repo", failing)).resolves.toBe(false);
    });

    it("returns null only for git-config exit code 1", async () => {
        const unset = vi.fn(async () => {
            throw Object.assign(new Error("unset"), { code: 1 });
        });
        await expect(readLocalHooksPath("/repo", unset)).resolves.toBeNull();

        const broken = vi.fn(async () => {
            throw Object.assign(new Error("broken"), { code: 128 });
        });
        await expect(
            readLocalHooksPath("/repo", broken)
        ).rejects.toThrow("broken");
    });

    it.each([".githooks\n", "./custom-hooks\n", "/absolute/hooks\n"])(
        "treats any non-empty local hooks path as linked: %s",
        async (value) => {
            await expect(
                hasLocalHooksPath("/repo", runnerResult(value))
            ).resolves.toBe(true);
        }
    );

    it.each(["", " \n"])(
        "treats an empty local hooks path as unlinked",
        async (value) => {
            await expect(
                hasLocalHooksPath("/repo", runnerResult(value))
            ).resolves.toBe(false);
        }
    );

    it("writes the fixed repository-local hooks path", async () => {
        const runGit = runnerResult("");
        await linkGitHooks("/repo", runGit);
        expect(runGit).toHaveBeenCalledWith(
            ["config", "--local", "core.hooksPath", ".githooks"],
            "/repo"
        );
    });
});
