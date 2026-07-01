import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({}));

const { topologyPlugin, TOPOLOGY_PLUGIN_ID } = await import(
    "../src/topology/plugin"
);

describe("topologyPlugin", () => {
    it("exposes a stable id and name", () => {
        expect(topologyPlugin.id).toBe(TOPOLOGY_PLUGIN_ID);
        expect(topologyPlugin.name).toBe("Topology");
    });

    it("does not contribute a markdown-it hook", () => {
        expect(topologyPlugin.contributeMarkdownIt).toBeUndefined();
    });

    it("defines an optional deactivate (lifecycle hint for the manager)", () => {
        expect(typeof topologyPlugin.deactivate).toBe("function");
    });
});
