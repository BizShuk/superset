import { describe, it, expect } from "vitest";
import { TopologyStore } from "../src/topology/topologyStore";
import { FakeTopologyScanner } from "./topologyScanner.fake";

describe("TopologyStore with FakeTopologyScanner", () => {
    it("builds the expected tree when scanner returns full fixtures", async () => {
        const scanner = new FakeTopologyScanner();
        scanner.interfaces = [
            {
                name: "en0",
                addresses: [
                    { address: "192.168.1.100", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:01" },
                    { address: "fe80::1", family: "IPv6", internal: false }
                ]
            },
            {
                name: "lo0",
                addresses: [
                    { address: "127.0.0.1", family: "IPv4", internal: true }
                ]
            }
        ];
        scanner.gateway = "192.168.1.1";
        scanner.hops = [
            { hop: "1", ip: "192.168.1.1", time: "1.2ms" },
            { hop: "2", ip: "10.0.0.1", time: "5.4ms" },
            { hop: "3", ip: "*", time: "" },
            { hop: "4", ip: "8.8.8.8", time: "12.3ms" }
        ];
        scanner.dnsServers = ["1.1.1.1", "8.8.4.4"];
        scanner.arpTable = [
            { ip: "192.168.1.1", mac: "11:22:33:44:55:66" }
        ];

        const store = new TopologyStore(scanner);
        await store.scan();

        const roots = store.getRoots();
        expect(roots).toHaveLength(4);

        // 1. Local Interfaces
        expect(roots[0].label).toBe("Local Interfaces");
        expect(roots[0].children).toHaveLength(2);
        expect(roots[0].children![0].label).toBe("en0: 192.168.1.100 (aa:bb:cc:dd:ee:01) [fe80::1]");
        expect(roots[0].children![1].label).toBe("lo0: 127.0.0.1 (loopback)");

        // 2. Routing
        expect(roots[1].label).toBe("Routing");
        expect(roots[1].children).toHaveLength(2);
        expect(roots[1].children![0]).toEqual({ label: "Default Gateway", description: "192.168.1.1" });
        
        const trace = roots[1].children![1];
        expect(trace.label).toBe("Trace 8.8.8.8");
        expect(trace.children).toHaveLength(1);
        
        const hop1Group = trace.children![0];
        expect(hop1Group.label).toBe("192.168.1.0/24");
        // Local IP is prepended as the first entry of the gateway's /24 group
        expect(hop1Group.children![0]).toEqual({ label: "192.168.1.100", description: "本機" });
        expect(hop1Group.children![1]).toEqual({ label: "192.168.1.1", description: "1.2ms" });

        const hop2Group = hop1Group.children![2];
        expect(hop2Group.label).toBe("10.0.0.0/24");
        expect(hop2Group.children![0]).toEqual({ label: "10.0.0.1", description: "5.4ms" });

        const hop3Group = hop2Group.children![1];
        expect(hop3Group.label).toBe("Unreachable");
        expect(hop3Group.children![0].label).toBe("* * *");

        const hop4Group = hop2Group.children![2];
        expect(hop4Group.label).toBe("8.8.8.0/24");
        expect(hop4Group.children![0]).toEqual({ label: "8.8.8.8", description: "12.3ms" });

        // 3. DNS Servers
        expect(roots[2]).toEqual({
            label: "DNS Servers",
            children: [
                { label: "1.1.1.1" },
                { label: "8.8.4.4" }
            ]
        });

        // 4. ARP Table
        expect(roots[3]).toEqual({
            label: "ARP Table",
            children: [
                { label: "192.168.1.1", description: "11:22:33:44:55:66" }
            ]
        });
    });

    it("hides Gateway if getDefaultGateway returns null", async () => {
        const scanner = new FakeTopologyScanner();
        scanner.gateway = null;
        scanner.dnsServers = ["1.1.1.1"];
        
        const store = new TopologyStore(scanner);
        await store.scan();

        const routing = store.getRoots().find(n => n.label === "Routing");
        expect(routing).toBeUndefined();
    });

    it("hides traceroute when trace is empty", async () => {
        const scanner = new FakeTopologyScanner();
        scanner.gateway = "192.168.1.1";
        scanner.hops = [];

        const store = new TopologyStore(scanner);
        await store.scan();

        const routing = store.getRoots().find(n => n.label === "Routing");
        expect(routing).toBeDefined();
        expect(routing!.children).toHaveLength(1);
        expect(routing!.children![0].label).toBe("Default Gateway");
    });

    it("hides ARP Table when arp is empty", async () => {
        const scanner = new FakeTopologyScanner();
        scanner.arpTable = [];

        const store = new TopologyStore(scanner);
        await store.scan();

        const arpNode = store.getRoots().find(n => n.label === "ARP Table");
        expect(arpNode).toBeUndefined();
    });

    it("retains previous scanned data when transport fails", async () => {
        const scanner = new FakeTopologyScanner();
        scanner.dnsServers = ["1.1.1.1"];
        
        const store = new TopologyStore(scanner);
        await store.scan();
        expect(store.getRoots()).toHaveLength(1);
        expect(store.getRoots()[0].label).toBe("DNS Servers");

        scanner.errorToThrow = new Error("Connection failed");
        await expect(store.scan()).rejects.toThrow("Connection failed");

        expect(store.getRoots()).toHaveLength(1);
        expect(store.getRoots()[0].label).toBe("DNS Servers");
    });

    it("concurrent scan calls share the in-flight promise", async () => {
        const scanner = new FakeTopologyScanner();
        scanner.dnsServers = ["1.1.1.1"];
        scanner.delayMs = 10;

        const store = new TopologyStore(scanner);
        const p1 = store.scan();
        const p2 = store.scan();

        expect(p1).toBe(p2);
        await Promise.all([p1, p2]);

        expect(scanner.resolveDnsServersCalls).toBe(1);
    });
});
