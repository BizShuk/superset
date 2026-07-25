import { describe, it, expect, afterEach, vi } from "vitest";

// ptyTapServer.ts imports `vscode` for the shell-execution subscriber.
// The server constructor itself only touches `net`/`fs`/`path`/`os`,
// so an empty vscode mock is enough for the lifecycle tests in this
// file. The shell-execution code path is exercised separately by the
// activation tests under `npm run build`.
vi.mock("vscode", () => ({}));

import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PtyTapServer } from "../src/terminals/ptyTapServer";
import type { Frame } from "../src/terminals/ptyTap";

/**
 * Live socket tests for `PtyTapServer`. Each test spins up the server
 * on a fresh temp Unix domain socket, connects one or two client
 * sockets, and asserts on the bytes the clients receive.
 */

const sockets: string[] = [];
const servers: PtyTapServer[] = [];

function tempSocketPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "superset-pty-test-"));
    const sock = path.join(dir, "tap.sock");
    sockets.push(sock);
    sockets.push(dir); // also clean up the dir
    return sock;
}

function connectClient(sockPath: string): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const s = net.connect(sockPath);
        s.once("connect", () => resolve(s));
        s.once("error", reject);
    });
}

function readLines(
    sock: net.Socket,
    timeoutMs = 500
): Promise<string[]> {
    return new Promise((resolve) => {
        const lines: string[] = [];
        let buf = "";
        let settled = false;
        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            // Flush any trailing partial line.
            if (buf.length > 0) {
                lines.push(buf);
            }
            resolve(lines);
        };
        const timer = setTimeout(finish, timeoutMs);
        sock.on("data", (chunk) => {
            buf += chunk.toString("utf8");
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
                lines.push(buf.slice(0, nl));
                buf = buf.slice(nl + 1);
            }
        });
        sock.on("end", () => {
            clearTimeout(timer);
            finish();
        });
        sock.on("close", () => {
            clearTimeout(timer);
            finish();
        });
        sock.on("error", () => {
            clearTimeout(timer);
            finish();
        });
    });
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

describe("PtyTapServer — basic fan-out", () => {
    it("emits NDJSON frames to connected clients", async () => {
        const sock = tempSocketPath();
        const server = await PtyTapServer.create(sock, () => {});
        servers.push(server);
        const client = await connectClient(sock);
        const linesPromise = readLines(client);

        const frame: Frame = { t: "open", id: 1, name: "zsh", kind: "pty", ts: 0 };
        server.write(frame);
        // Give Node time to deliver the bytes before closing.
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        client.end();

        const lines = await linesPromise;
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0])).toEqual(frame);
    });

    it("broadcasts every frame to every connected client", async () => {
        const sock = tempSocketPath();
        const server = await PtyTapServer.create(sock, () => {});
        servers.push(server);
        const c1 = await connectClient(sock);
        const c2 = await connectClient(sock);
        const l1 = readLines(c1);
        const l2 = readLines(c2);

        server.write({
            t: "data",
            id: 1,
            chunk: "broadcast\n",
            ts: 7,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        c1.end();
        c2.end();

        const [lines1, lines2] = await Promise.all([l1, l2]);
        expect(JSON.parse(lines1[0])).toMatchObject({ chunk: "broadcast\n" });
        expect(JSON.parse(lines2[0])).toMatchObject({ chunk: "broadcast\n" });
    });

    it("does not crash when a client disconnects mid-stream", async () => {
        const sock = tempSocketPath();
        const server = await PtyTapServer.create(sock, () => {});
        servers.push(server);
        const client = await connectClient(sock);
        const linesPromise = readLines(client, 100);
        client.destroy(); // mid-stream destroy should not crash the server

        server.write({ t: "open", id: 1, name: "x", kind: "pty", ts: 0 });
        server.write({ t: "data", id: 1, chunk: "hi\n", ts: 0 });

        // Server should still work; connect a new client.
        const c2 = await connectClient(sock);
        const l2 = readLines(c2);
        server.write({ t: "data", id: 1, chunk: "after\n", ts: 0 });
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        c2.end();
        const lines2 = await l2;
        expect(JSON.parse(lines2[0])).toMatchObject({ chunk: "after\n" });

        // Drain the destroyed client too.
        await linesPromise;
    });
});

describe("PtyTapServer — lifecycle", () => {
    it("stop() unlinks the socket file", async () => {
        const sock = tempSocketPath();
        const server = await PtyTapServer.create(sock, () => {});
        expect(fs.existsSync(sock)).toBe(true);
        await server.stop();
        expect(fs.existsSync(sock)).toBe(false);
    });

    it("creates ~/.config/superset/pty/ if missing", async () => {
        // The defaultTapSocketPath uses the real homedir; we mock it by
        // pointing PtyTapServer at a path under a fresh tmpdir to keep
        // the test self-contained.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "superset-pty-mkdir-"));
        sockets.push(tmp);
        const sock = path.join(tmp, "deep", "nested", "tap.sock");
        sockets.push(path.join(tmp, "deep"));
        const server = await PtyTapServer.create(sock, () => {});
        servers.push(server);
        expect(fs.existsSync(sock)).toBe(true);
    });
});
