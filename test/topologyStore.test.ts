import { describe, it, expect, vi } from "vitest";
import { TopologyStore } from "../src/topology/topologyStore";
import type { ScannerTransport } from "../src/topology/topologyScanner";

function fakeTransport(
    interfaces: any[] = [],
    gateway: string | null = null,
    hops: any[] = [],
    dns: string[] = [],
    arp: any[] = []
): ScannerTransport {
    return {
        listInterfaces: vi.fn().mockResolvedValue(interfaces),
        getDefaultGateway: vi.fn().mockResolvedValue(gateway),
        traceroute: vi.fn().mockResolvedValue(hops),
        resolveDnsServers: vi.fn().mockResolvedValue(dns),
        listArpTable: vi.fn().mockResolvedValue(arp),
    };
}

describe("TopologyStore", () => {
    it("starts with empty nodes", () => {
        const store = new TopologyStore(fakeTransport());
        expect(store.getRoots()).toEqual([]);
    });

    it("scan populates nodes and emits scanned event", async () => {
        const transport = fakeTransport(
            [
                {
                    name: "en0",
                    addresses: [
                        { address: "192.168.1.2", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:ff" }
                    ]
                }
            ]
        );
        const store = new TopologyStore(transport);
        const listener = vi.fn();
        store.onDidChange(listener);

        await store.scan();

        expect(transport.listInterfaces).toHaveBeenCalledTimes(1);
        expect(store.getRoots()).toEqual([
            {
                label: "Local Interfaces",
                children: [
                    { label: "en0: 192.168.1.2 (aa:bb:cc:dd:ee:ff)" }
                ]
            }
        ]);
        expect(listener).toHaveBeenCalledWith({
            type: "scanned",
            nodes: store.getRoots(),
        });
    });

    it("scan replaces previous nodes", async () => {
        const transport = fakeTransport();
        vi.mocked(transport.resolveDnsServers)
            .mockResolvedValueOnce(["1.1.1.1"])
            .mockResolvedValueOnce(["2.2.2.2"]);

        const store = new TopologyStore(transport);
        await store.scan();
        expect(store.getRoots()).toEqual([
            {
                label: "DNS Servers",
                children: [{ label: "1.1.1.1" }]
            }
        ]);
        await store.scan();
        expect(store.getRoots()).toEqual([
            {
                label: "DNS Servers",
                children: [{ label: "2.2.2.2" }]
            }
        ]);
    });

    it("listener unsubscribe stops events", async () => {
        const transport = fakeTransport([], null, [], ["1.1.1.1"]);
        const store = new TopologyStore(transport);
        const listener = vi.fn();
        const off = store.onDidChange(listener);
        off();
        await store.scan();
        expect(listener).not.toHaveBeenCalled();
    });
});