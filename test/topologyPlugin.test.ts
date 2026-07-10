import { describe, it, vi } from "vitest";
import { assertPluginContract } from "./pluginContract.shared";

vi.mock("vscode", () => ({}));

const { topologyPlugin, TOPOLOGY_PLUGIN_ID } = await import(
    "../src/topology/plugin"
);

describe("topologyPlugin", () => {
    it("satisfies the ExtensionPlugin contract", () => {
        assertPluginContract(topologyPlugin, {
            id: TOPOLOGY_PLUGIN_ID,
            name: "Topology",
            markdownHook: "absent",
            deactivate: "present",
        });
    });
});
