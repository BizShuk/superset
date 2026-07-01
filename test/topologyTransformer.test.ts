import { describe, it, expect } from "vitest";
import { transformScan, type ScanInputs } from "../src/topology/transformer";

const empty: ScanInputs = {
    interfaces: [],
    gateway: null,
    hops: null,
    dnsServers: [],
    arp: [],
};

describe("transformScan", () => {
    it("returns [] for fully empty inputs", () => {
        expect(transformScan(empty)).toEqual([]);
    });

    it("builds Local Interfaces with loopback entries appended", () => {
        const nodes = transformScan({
            ...empty,
            interfaces: [
                {
                    name: "en0",
                    addresses: [
                        { address: "10.0.0.5", family: "IPv4", internal: false, mac: "aa:bb" },
                    ],
                },
                {
                    name: "lo0",
                    addresses: [
                        { address: "127.0.0.1", family: "IPv4", internal: true },
                    ],
                },
            ],
        });
        expect(nodes).toHaveLength(1);
        expect(nodes[0]!.label).toBe("Local Interfaces");
        const labels = nodes[0]!.children!.map((c) => c.label);
        expect(labels).toEqual([
            "en0: 10.0.0.5 (aa:bb)",
            "lo0: 127.0.0.1 (loopback)",
        ]);
    });

    it("annotates IPv4 with IPv6 sibling addresses when both are present", () => {
        const nodes = transformScan({
            ...empty,
            interfaces: [
                {
                    name: "en0",
                    addresses: [
                        { address: "10.0.0.5", family: "IPv4", internal: false, mac: "aa:bb" },
                        { address: "fe80::1", family: "IPv6", internal: false },
                    ],
                },
            ],
        });
        const child = nodes[0]!.children![0]!;
        expect(child.label).toBe("en0: 10.0.0.5 (aa:bb) [fe80::1]");
    });

    it("groups trace hops by /24 subnet, splitting on subnet change", () => {
        // Subnet change behavior: when the subnet flips, the new group
        // is nested INSIDE the previous group's children (see
        // `insertInto` — it walks to the deepest parent whose last
        // child is a /24 group with children). This produces a
        // "trace path" tree where adjacent /24s nest rather than
        // appearing as siblings.
        const nodes = transformScan({
            ...empty,
            hops: [
                { hop: "1", ip: "10.0.0.1", time: "1ms" },
                { hop: "2", ip: "10.0.0.2", time: "2ms" },
                { hop: "3", ip: "10.0.1.1", time: "3ms" },
            ],
        });
        const trace = nodes
            .find((n) => n.label === "Routing")!
            .children!.find((c) => c.label.startsWith("Trace "))!;
        // First group is at the trace root; second nests inside it.
        const first = trace.children![0]!;
        expect(first.label).toBe("10.0.0.0/24");
        // All hops in /24 #1 are direct children until the subnet
        // flip; then the new /24 nests inside (per `insertInto`).
        expect(first.children!.map((c) => c.label)).toEqual([
            "10.0.0.1",
            "10.0.0.2",
            "10.0.1.0/24",
        ]);
        const second = first.children!.find((c) => c.label === "10.0.1.0/24")!;
        expect(second.children![0]!.label).toBe("10.0.1.1");
    });

    it("marks '*' hops as Unreachable with '* * *' placeholders", () => {
        // '*' is its own special subnet ("Unreachable" label, no '/').
        // The placeholder "* * *" lives directly inside that group.
        const nodes = transformScan({
            ...empty,
            hops: [
                { hop: "1", ip: "10.0.0.1", time: "" },
                { hop: "2", ip: "*", time: "" },
            ],
        });
        const trace = nodes
            .find((n) => n.label === "Routing")!
            .children!.find((c) => c.label.startsWith("Trace "))!;
        const first = trace.children![0]!;
        expect(first.label).toBe("10.0.0.0/24");
        const unreachable = first.children!.find((c) => c.label === "Unreachable")!;
        expect(unreachable.children).toEqual([{ label: "* * *" }]);
    });

    it("returns no Routing node when there are no hops and no gateway", () => {
        const nodes = transformScan({ ...empty, gateway: null });
        expect(nodes.find((n) => n.label === "Routing")).toBeUndefined();
    });

    it("builds DNS Servers and ARP Table only when populated", () => {
        const nodes = transformScan({
            ...empty,
            dnsServers: ["8.8.8.8", "1.1.1.1"],
            arp: [{ ip: "10.0.0.1", mac: "aa:bb:cc:dd:ee:ff" }],
        });
        const dns = nodes.find((n) => n.label === "DNS Servers")!;
        expect(dns.children!.map((c) => c.label)).toEqual(["8.8.8.8", "1.1.1.1"]);
        const arp = nodes.find((n) => n.label === "ARP Table")!;
        expect(arp.children![0]).toEqual({
            label: "10.0.0.1",
            description: "aa:bb:cc:dd:ee:ff",
        });
    });

    it("preserves section order: Interfaces → Routing → DNS → ARP", () => {
        const nodes = transformScan({
            interfaces: [
                {
                    name: "en0",
                    addresses: [
                        { address: "10.0.0.5", family: "IPv4", internal: false },
                    ],
                },
            ],
            gateway: "10.0.0.1",
            hops: [{ hop: "1", ip: "10.0.0.1", time: "" }],
            dnsServers: ["8.8.8.8"],
            arp: [{ ip: "10.0.0.1", mac: "aa:bb:cc:dd:ee:ff" }],
        });
        expect(nodes.map((n) => n.label)).toEqual([
            "Local Interfaces",
            "Routing",
            "DNS Servers",
            "ARP Table",
        ]);
    });
});
