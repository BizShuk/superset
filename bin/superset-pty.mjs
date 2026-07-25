#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// superset-pty — listen to every PTY-backed and Shell Integration
// terminal in a single VS Code window.
//
// Usage:
//   node bin/superset-pty.mjs [--socket PATH] [--filter REGEX]
//                             [--raw] [--quiet]
//
// Default socket path (per-window):
//   ~/.config/superset/pty/<vscode-sessionId>-<ext-host-pid>.sock
//
// Exit codes:
//   0  clean EOF / socket closed by extension
//   1  socket missing (extension not running / tap disabled)
//   2  argument parse error (bad regex etc.)
//
// Theory under test: every terminal in a single VS Code window can be
// observed from a single outside process. See
// plans/dreamy-finding-rainbow.md for the design.

import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";

const PROG = "superset-pty";

function usage() {
    process.stderr.write(
        `Usage: ${PROG} [--socket PATH] [--filter REGEX] [--raw] [--quiet]\n` +
            "\n" +
            "Options:\n" +
            "  --socket PATH   Override socket path (default:\n" +
            "                  ~/.config/superset/pty/<sid>-<pid>.sock)\n" +
            "  --filter REGEX  Only emit frames whose terminal name matches\n" +
            "  --raw           Drop framing; print only data chunks\n" +
            "  --quiet         Suppress connect/disconnect banner on stderr\n"
    );
}

function defaultSocketPath() {
    // The extension writes the path to stdout on activation in a future
    // iteration. For the PoC we mirror the same convention the extension
    // uses (`defaultTapSocketPath` in `src/terminals/ptyTapServer.ts`):
    // ~/.config/superset/pty/<sessionId>-<pid>.sock.
    //
    // We cannot recover the VS Code `sessionId` from outside the
    // extension, so the CLI defaults to scanning the directory for any
    // `*.sock` file and picking the most recently modified. This is
    // good enough for the PoC; the user can override with --socket.
    const dir = path.join(os.homedir(), ".config", "superset", "pty");
    try {
        const entries = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".sock"))
            .map((f) => {
                const full = path.join(dir, f);
                try {
                    const stat = fs.statSync(full);
                    return { full, mtime: stat.mtimeMs };
                } catch {
                    return null;
                }
            })
            .filter((e) => e !== null)
            .sort((a, b) => b.mtime - a.mtime);
        return entries.length > 0 ? entries[0].full : null;
    } catch {
        return null;
    }
}

function parseArgs(argv) {
    const out = {
        socket: null,
        filter: null,
        raw: false,
        quiet: false,
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case "--socket":
                out.socket = argv[++i] ?? null;
                break;
            case "--filter":
                out.filter = argv[++i] ?? null;
                break;
            case "--raw":
                out.raw = true;
                break;
            case "--quiet":
                out.quiet = true;
                break;
            case "-h":
            case "--help":
                out.help = true;
                break;
            default:
                process.stderr.write(`${PROG}: unknown argument: ${a}\n`);
                process.exit(2);
        }
    }
    if (out.filter) {
        try {
            out.filter = new RegExp(out.filter);
        } catch (err) {
            process.stderr.write(
                `${PROG}: --filter regex parse error: ${err.message}\n`
            );
            process.exit(2);
        }
    }
    return out;
}

function banner(msg) {
    return `[${PROG}] ${msg}`;
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        usage();
        process.exit(0);
    }

    const socketPath = opts.socket ?? defaultSocketPath();
    if (!socketPath) {
        process.stderr.write(
            banner(
                "no socket path found. Is the superset extension running?\n" +
                    "Hint: pass --socket PATH or start a PTY terminal first.\n"
            )
        );
        process.exit(1);
    }

    if (!fs.existsSync(socketPath)) {
        process.stderr.write(
            banner(`socket not found: ${socketPath}\n`) +
                banner(
                    "the extension may not be running, or no PTY terminals are open.\n"
                )
        );
        process.exit(1);
    }

    if (!opts.quiet) {
        process.stderr.write(banner(`connecting to ${socketPath}\n`));
    }

    const socket = net.connect(socketPath);
    const openNames = new Map(); // id -> name, for --filter on data frames

    socket.on("connect", () => {
        if (!opts.quiet) {
            process.stderr.write(banner("connected\n"));
        }
    });

    socket.on("error", (err) => {
        process.stderr.write(banner(`socket ERROR: ${err.message}\n`));
        process.exit(1);
    });

    socket.on("close", () => {
        if (!opts.quiet) {
            process.stderr.write(banner("disconnected\n"));
        }
        process.exit(0);
    });

    const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });

    rl.on("line", (line) => {
        if (line.length === 0) {
            return;
        }
        let frame;
        try {
            frame = JSON.parse(line);
        } catch (err) {
            process.stderr.write(banner(`malformed frame: ${err.message}\n`));
            return;
        }
        if (opts.filter) {
            // Track names per terminal id so we can filter data frames too.
            if (frame.t === "open") {
                openNames.set(frame.id, frame.name);
                if (!opts.filter.test(frame.name)) {
                    return;
                }
            } else if (frame.t === "data") {
                const name = openNames.get(frame.id);
                if (!name || !opts.filter.test(name)) {
                    return;
                }
            } else if (frame.t === "close") {
                openNames.delete(frame.id);
            }
        }
        if (opts.raw) {
            if (frame.t === "data") {
                process.stdout.write(frame.chunk);
            }
            // Drop meta/open/close frames in raw mode.
            return;
        }
        process.stdout.write(`${line}\n`);
    });
}

main();
