// Interface-contract test for the `git` feature plugin. Mirrors
// `terminalsPlugin.test.ts` / `mdnsPlugin.test.ts` — only asserts
// the stable plugin contract (id / name / no markdown-it hook /
// deactivate presence). Heavy integration coverage of the reset
// commands lives in `gitReset.test.ts` (pure helpers) and the
// install-command test file (same `spawnRunTerminal` bridge is
// exercised end-to-end there).

import { describe, it, vi } from "vitest";
import { assertPluginContract } from "./pluginContract.shared";

// Minimal vscode mock — the git plugin chain imports `./index.ts`
// which reaches for `vscode` surface. We only check interface-level
// invariants here; full activation is exercised in the extension
// host under `npm run build` / manual F5 verification.
vi.mock("vscode", () => ({}));

const { gitPlugin, GIT_PLUGIN_ID } = await import("../src/git/plugin");

describe("gitPlugin", () => {
    it("satisfies the ExtensionPlugin contract", () => {
        assertPluginContract(gitPlugin, {
            id: GIT_PLUGIN_ID,
            name: "Git",
            markdownHook: "absent",
            deactivate: "present",
        });
    });
});