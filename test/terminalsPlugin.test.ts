import { describe, it, vi } from "vitest";
import { assertPluginContract } from "./pluginContract.shared";

// Minimal vscode mock — the terminals plugin chain imports `./index.ts`
// which reaches for vscode surface. We only check interface-level
// invariants here; full activation is exercised in the extension host.
vi.mock("vscode", () => ({}));

const { terminalsPlugin, TERMINALS_PLUGIN_ID } = await import(
    "../src/terminals/plugin"
);

describe("terminalsPlugin", () => {
    it("satisfies the ExtensionPlugin contract", () => {
        assertPluginContract(terminalsPlugin, {
            id: TERMINALS_PLUGIN_ID,
            name: "Terminals",
            markdownHook: "absent",
            deactivate: "present",
        });
    });
});
