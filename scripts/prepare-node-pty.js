#!/usr/bin/env node
"use strict";

// node-pty 1.1.0 ships the macOS prebuilt `spawn-helper` files without an
// executable bit. macOS then rejects every PTY launch with
// `posix_spawnp failed`. Run after each root `npm install` so both macOS
// architectures enter the VSIX as executable files, even when the release is
// packaged on Linux.

const fs = require("node:fs");
const path = require("node:path");

if (process.platform === "win32") {
    console.log(
        "[prepare-node-pty] skipped on Windows (POSIX modes are unavailable)"
    );
    process.exit(0);
}

const nodePtyRoot = path.dirname(require.resolve("node-pty/package.json"));
const prebuildsRoot = path.join(nodePtyRoot, "prebuilds");
const candidates = [];

if (fs.existsSync(prebuildsRoot)) {
    for (const entry of fs.readdirSync(prebuildsRoot, {
        withFileTypes: true,
    })) {
        if (entry.isDirectory() && entry.name.startsWith("darwin-")) {
            candidates.push(
                path.join(prebuildsRoot, entry.name, "spawn-helper")
            );
        }
    }
}

candidates.push(path.join(nodePtyRoot, "build", "Release", "spawn-helper"));

const helpers = candidates.filter((candidate) => fs.existsSync(candidate));
if (helpers.length === 0) {
    throw new Error(
        `node-pty spawn-helper not found under ${nodePtyRoot}`
    );
}

for (const helper of helpers) {
    const currentMode = fs.statSync(helper).mode & 0o777;
    fs.chmodSync(helper, currentMode | 0o111);
    const preparedMode = fs.statSync(helper).mode & 0o777;
    if ((preparedMode & 0o111) === 0) {
        throw new Error(`node-pty spawn-helper is not executable: ${helper}`);
    }
}

console.log(
    `[prepare-node-pty] executable spawn-helper files: ${helpers.length}`
);
