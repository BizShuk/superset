import { describe, it, expect, afterEach, vi } from "vitest";

// PtyTapServer imports `vscode` for the shell-execution subscriber.
// Empty mock is enough for the CLI tests, which only exercise the
// socket framing path.
vi.mock("vscode", () => ({}));

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { PtyTapServer } from "../src/terminals/ptyTapServer";
import type { Frame } from "../src/terminals/ptyTap";

/**
 * End-to-end CLI tests: spawn `bin/superset-pty.mjs` against a real
 * PtyTapServer on a temp socket, write frames from the test, assert on
 * the CLI's stdout.
 */

const cliPath = path.resolve(
    __dirname,
    "..",
    "bin",
    "superset-pty.mjs"
);

const sockets: string[] = [];
const servers: PtyTapServer[] = [];

function tempSocketPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superset-cli-test-"));
    const sock = path.join(dir, "tap.sock");
    sockets.push(dir);
    sockets.push(sock);
    return sock;
}

interface SpawnResult {
    proc: ReturnType<typeof spawn>;
    stdout: () => Promise<string>;
    stderr: () => Promise<string>;
    waitExit: (timeoutMs?: number) => Promise<{ code: number | null }>;
}

function spawnCli(
    args: string[],
    env: Record<string, string | undefined> = {}
): SpawnResult {
    const proc = spawn("node", [cliPath, ...args], {
        env: { ...process.env, ...env },
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    proc.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    let exitCode: number | null | undefined;
    proc.on("exit", (code) => {
        exitCode = code;
    });
    return {
        proc,
        stdout: () =>
            new Promise((resolve) => {
                proc.stdout.once("end", () =>
                    resolve(Buffer.concat(stdoutChunks).toString("utf8"))
                );
            }),
        stderr: () =>
            new Promise((resolve) => {
                proc.stderr.once("end", () =>
                    resolve(Buffer.concat(stderrChunks).toString("utf8"))
                );
            }),
        waitExit: (timeoutMs = 2000) =>
            new Promise((resolve) => {
                if (exitCode !== undefined) {
                    resolve({ code: exitCode });
                    return;
                }
                const t = setTimeout(() => {
                    proc.kill();
                    resolve({ code: null });
                }, timeoutMs);
                proc.on("exit", (code) => {
                    clearTimeout(t);
                    resolve({ code });
                });
            }),
    };
}

afterEach(async () => {
    for (const s of servers.splice(0)) {
        await s.stop();
    }
    for (const p of sockets.splice(0)) {
        try {
            fs.rmSync(p, { recursive: true, force: true });
        } catch {
            // ignore
        }
    }
});

describe("superset-pty CLI", () => {
    it("prints NDJSON frames in default mode", async () => {
        const sock = tempSocketPath();
        const server = await PtyTapServer.create(sock, () => {});
        servers.push(server);

        const cli = spawnCli(["--socket", sock, "--quiet"]);

        // Wait for the client to connect before writing.
        await new Promise<void>((resolve) => setTimeout(resolve, 50));

        const frames: Frame[] = [
            { t: "open", id: 1, name: "zsh", kind: "pty", ts: 0 },
            { t: "data", id: 1, chunk: "hello\n", ts: 1 },
            { t: "close", id: 1, code: 0, ts: 2 },
        ];
        for (const f of frames) {
            server.write(f);
        }

        // Allow the CLI to flush, then disconnect it.
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        cli.proc.kill();
        const [stdout] = await Promise.all([cli.stdout(), cli.waitExit()]);

        const lines = stdout.split("\n").filter(Boolean);
        expect(lines).toHaveLength(3);
        expect(JSON.parse(lines[0])).toMatchObject({ t: "open", name: "zsh" });
        expect(JSON.parse(lines[1])).toMatchObject({
            t: "data",
            chunk: "hello\n",
        });
        expect(JSON.parse(lines[2])).toMatchObject({ t: "close", code: 0 });
    });

    it("--raw strips framing and prints only data chunks", async () => {
        const sock = tempSocketPath();
        const server = await PtyTapServer.create(sock, () => {});
        servers.push(server);

        const cli = spawnCli(["--socket", sock, "--raw", "--quiet"]);

        await new Promise<void>((resolve) => setTimeout(resolve, 50));

        server.write({ t: "open", id: 1, name: "zsh", kind: "pty", ts: 0 });
        server.write({ t: "data", id: 1, chunk: "raw-mode-1\n", ts: 1 });
        server.write({ t: "data", id: 1, chunk: "raw-mode-2\n", ts: 2 });
        server.write({ t: "close", id: 1, code: 0, ts: 3 });

        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        cli.proc.kill();
        const [stdout] = await Promise.all([cli.stdout(), cli.waitExit()]);

        expect(stdout).toBe("raw-mode-1\nraw-mode-2\n");
    });

    it("--filter limits output to terminals whose name matches", async () => {
        const sock = tempSocketPath();
        const server = await PtyTapServer.create(sock, () => {});
        servers.push(server);

        const cli = spawnCli([
            "--socket",
            sock,
            "--raw",
            "--quiet",
            "--filter",
            "^wanted$",
        ]);

        await new Promise<void>((resolve) => setTimeout(resolve, 50));

        server.write({ t: "open", id: 1, name: "wanted", kind: "pty", ts: 0 });
        server.write({ t: "open", id: 2, name: "skip-me", kind: "pty", ts: 0 });
        server.write({ t: "data", id: 1, chunk: "kept\n", ts: 1 });
        server.write({ t: "data", id: 2, chunk: "dropped\n", ts: 1 });

        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        cli.proc.kill();
        const [stdout] = await Promise.all([cli.stdout(), cli.waitExit()]);

        expect(stdout).toBe("kept\n");
    });

    it("exits with code 1 and friendly stderr when the socket is missing", async () => {
        const missing = path.join(
            os.tmpdir(),
            `superset-pty-missing-${Date.now()}.sock`
        );
        const cli = spawnCli(["--socket", missing, "--quiet"]);
        const [, { code }, stderr] = await Promise.all([
            cli.stdout(),
            cli.waitExit(),
            cli.stderr(),
        ]);
        expect(code).toBe(1);
        expect(stderr).toMatch(/socket not found/);
    });

    it("exits with code 2 on a bad --filter regex", async () => {
        const cli = spawnCli(["--filter", "(["]);
        const [{ code }, stderr] = await Promise.all([
            cli.waitExit(),
            cli.stderr(),
        ]);
        expect(code).toBe(2);
        expect(stderr).toMatch(/regex parse error/);
    });
});
