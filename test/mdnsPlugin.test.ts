import { describe, it, vi } from "vitest";
import { assertPluginContract } from "./pluginContract.shared";

// Minimal vscode mock — the mdns plugin chain imports `./index.ts`
// which reaches for vscode surface. We only check interface-level
// invariants here; full activation is exercised in the extension host.
vi.mock("vscode", () => ({}));

const { mdnsPlugin, MDNS_PLUGIN_ID } = await import("../src/mdns/plugin");

describe("mdnsPlugin", () => {
    it("satisfies the ExtensionPlugin contract", () => {
        assertPluginContract(mdnsPlugin, {
            id: MDNS_PLUGIN_ID,
            name: "mDNS",
            markdownHook: "absent",
            deactivate: "present",
        });
    });
});
