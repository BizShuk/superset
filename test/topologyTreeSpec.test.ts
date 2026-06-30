import { describe, it, expect } from "vitest";
import { buildTopologySpec } from "../src/topology/topologyTreeSpec";

describe("buildTopologySpec", () => {
    it("handles group nodes (with children) correctly", () => {
        const node = {
            label: "Routing",
            description: "Default route details",
            children: [{ label: "Default Gateway" }]
        };
        const spec = buildTopologySpec(node);
        expect(spec).toEqual({
            label: "Routing",
            description: "Default route details",
            iconKind: "group",
            contextValue: "topologyGroup"
        });
    });

    it("handles leaf nodes (without children) correctly", () => {
        const node = {
            label: "192.168.1.1",
            description: "11:22:33:44:55:66"
        };
        const spec = buildTopologySpec(node);
        expect(spec).toEqual({
            label: "192.168.1.1",
            description: "11:22:33:44:55:66",
            iconKind: "leaf",
            contextValue: "topologyLeaf"
        });
    });

    it("handles nodes without description correctly", () => {
        const node = {
            label: "DNS Servers"
        };
        const spec = buildTopologySpec(node);
        expect(spec).toEqual({
            label: "DNS Servers",
            description: undefined,
            iconKind: "leaf",
            contextValue: "topologyLeaf"
        });
    });
});
