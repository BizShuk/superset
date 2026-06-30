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

    it("scan prepends local IPv4 matching gateway /24 to trace", async () => {
        const transport = fakeTransport(
            [{ name: "en0", addresses: [{ address: "192.168.1.100", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:ff" }] }],
            "192.168.1.1",
            [{ hop: "1", ip: "192.168.1.1", time: "1.2ms" }],
            [],
            []
        );
        const store = new TopologyStore(transport);
        await store.scan();

        const routing = store.getRoots().find((n) => n.label === "Routing")!;
        const trace = routing.children!.find((c) => c.label.startsWith("Trace"))!;
        const subnetGroup = trace.children![0];
        expect(subnetGroup.label).toBe("192.168.1.0/24");
        expect(subnetGroup.children![0]).toEqual({ label: "192.168.1.100", description: "本機" });
        expect(subnetGroup.children![1]).toEqual({ label: "192.168.1.1", description: "1.2ms" });
    });

    it("scan does not duplicate local IP if already in trace", async () => {
        const transport = fakeTransport(
            [{ name: "en0", addresses: [{ address: "192.168.1.100", family: "IPv4", internal: false, mac: "aa" }] }],
            "192.168.1.1",
            [
                { hop: "1", ip: "192.168.1.100", time: "0.1ms" },
                { hop: "2", ip: "192.168.1.1", time: "1.2ms" },
            ],
            [],
            []
        );
        const store = new TopologyStore(transport);
        await store.scan();

        const trace = store.getRoots()
            .find((n) => n.label === "Routing")!
            .children!.find((c) => c.label.startsWith("Trace"))!;
        const subnetGroup = trace.children![0];
        expect(subnetGroup.children).toHaveLength(2);
    });

    it("scan skips prepending when no usable IPv4 exists", async () => {
        const transport = fakeTransport(
            [{ name: "lo0", addresses: [{ address: "127.0.0.1", family: "IPv4", internal: true, mac: "" }] }],
            "192.168.1.1",
            [{ hop: "1", ip: "192.168.1.1", time: "1.2ms" }],
            [],
            []
        );
        const store = new TopologyStore(transport);
        await store.scan();

        const trace = store.getRoots()
            .find((n) => n.label === "Routing")!
            .children!.find((c) => c.label.startsWith("Trace"))!;
        expect(trace.children).toHaveLength(1);
        expect(trace.children![0].children).toHaveLength(1);
        expect(trace.children![0].children![0].label).toBe("192.168.1.1");
    });

    it("scan does not show trace when hops are empty even if localIp exists", async () => {
        const transport = fakeTransport(
            [{ name: "en0", addresses: [{ address: "192.168.1.100", family: "IPv4", internal: false, mac: "aa" }] }],
            "192.168.1.1",
            [],
            [],
            []
        );
        const store = new TopologyStore(transport);
        await store.scan();

        // Routing section still exists (Default Gateway shown) but no trace subtree
        const routing = store.getRoots().find((n) => n.label === "Routing");
        expect(routing).toBeDefined();
        expect(routing!.children).toHaveLength(1);
        expect(routing!.children![0].label).toBe("Default Gateway");
        expect(routing!.children!.find((c) => c.label.startsWith("Trace"))).toBeUndefined();
    });

    it("scan picks IPv4 matching gateway /24 when multi-NIC", async () => {
        const transport = fakeTransport(
            [
                { name: "en0", addresses: [{ address: "10.0.0.50", family: "IPv4", internal: false, mac: "aa" }] },
                { name: "en1", addresses: [{ address: "192.168.1.100", family: "IPv4", internal: false, mac: "bb" }] },
            ],
            "192.168.1.1",
            [{ hop: "1", ip: "192.168.1.1", time: "1.2ms" }],
            [],
            []
        );
        const store = new TopologyStore(transport);
        await store.scan();

        const trace = store.getRoots()
            .find((n) => n.label === "Routing")!
            .children!.find((c) => c.label.startsWith("Trace"))!;
        const subnetGroup = trace.children![0];
        expect(subnetGroup.label).toBe("192.168.1.0/24");
        expect(subnetGroup.children![0]).toEqual({ label: "192.168.1.100", description: "本機" });
    });
});