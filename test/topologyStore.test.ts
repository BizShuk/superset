import { describe, it, expect, vi } from "vitest";
import { TopologyStore, type TopologyScanner } from "../src/topology/topologyStore";
import type { TopologyNode } from "../src/topology/types";

function fakeScanner(nodes: TopologyNode[]): TopologyScanner {
    return { scan: vi.fn().mockResolvedValue(nodes) };
}

describe("TopologyStore", () => {
    it("starts with empty nodes", () => {
        const store = new TopologyStore(fakeScanner([]));
        expect(store.getRoots()).toEqual([]);
    });

    it("scan populates nodes and emits scanned event", async () => {
        const nodes: TopologyNode[] = [
            { label: "en0", description: "192.168.1.1" },
        ];
        const scanner = fakeScanner(nodes);
        const store = new TopologyStore(scanner);
        const listener = vi.fn();
        store.onDidChange(listener);

        await store.scan();

        expect(scanner.scan).toHaveBeenCalledTimes(1);
        expect(store.getRoots()).toEqual(nodes);
        expect(listener).toHaveBeenCalledWith({
            type: "scanned",
            nodes,
        });
    });

    it("scan replaces previous nodes", async () => {
        const first = [{ label: "a" }];
        const second = [{ label: "b" }];
        const scanner = {
            scan: vi
                .fn()
                .mockResolvedValueOnce(first)
                .mockResolvedValueOnce(second),
        };
        const store = new TopologyStore(scanner);
        await store.scan();
        expect(store.getRoots()).toEqual(first);
        await store.scan();
        expect(store.getRoots()).toEqual(second);
    });

    it("listener unsubscribe stops events", async () => {
        const store = new TopologyStore(fakeScanner([{ label: "a" }]));
        const listener = vi.fn();
        const off = store.onDidChange(listener);
        off();
        await store.scan();
        expect(listener).not.toHaveBeenCalled();
    });
});