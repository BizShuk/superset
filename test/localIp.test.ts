import { describe, it, expect } from "vitest";
import { deriveLocalIp } from "../src/topology/localIp";
import type { NetworkInterface } from "../src/topology/topologyScanner";

const ipv4 = (address: string, internal = false) => ({
    address,
    family: "IPv4" as const,
    internal,
});
const v6 = (address: string) => ({
    address,
    family: "IPv6" as const,
    internal: false,
});

const ifaces = (
    ...entries: { name: string; addresses: NetworkInterface["addresses"] }[]
): NetworkInterface[] => entries as unknown as NetworkInterface[];

describe("deriveLocalIp", () => {
    it("returns null when interfaces is empty", () => {
        expect(deriveLocalIp([], "192.168.1.1")).toBeNull();
    });

    it("returns null when no IPv4 address exists", () => {
        expect(
            deriveLocalIp(ifaces({ name: "en0", addresses: [v6("fe80::1")] }), "fe80::1"),
        ).toBeNull();
    });

    it("returns null when only loopback IPv4 exists", () => {
        expect(
            deriveLocalIp(
                ifaces({ name: "lo0", addresses: [ipv4("127.0.0.1", true)] }),
                "127.0.0.1",
            ),
        ).toBeNull();
    });

    it("prefers IPv4 matching gateway's /24 subnet", () => {
        const result = deriveLocalIp(
            ifaces(
                { name: "en0", addresses: [ipv4("10.0.0.50"), v6("fe80::1")] },
                { name: "en1", addresses: [ipv4("192.168.1.100")] },
            ),
            "192.168.1.1",
        );
        expect(result).toBe("192.168.1.100");
    });

    it("falls back to first non-internal IPv4 when no gateway", () => {
        const result = deriveLocalIp(
            ifaces({ name: "en0", addresses: [ipv4("10.0.0.50"), v6("fe80::1")] }),
            null,
        );
        expect(result).toBe("10.0.0.50");
    });

    it("falls back to first non-internal IPv4 when gateway has no /24 match", () => {
        const result = deriveLocalIp(
            ifaces(
                { name: "en0", addresses: [ipv4("10.0.0.50")] },
                { name: "en1", addresses: [ipv4("172.16.5.5")] },
            ),
            "192.168.1.1",
        );
        expect(result).toBe("10.0.0.50");
    });

    it("ignores malformed gateway IP", () => {
        const result = deriveLocalIp(
            ifaces({ name: "en0", addresses: [ipv4("10.0.0.50")] }),
            "not-an-ip",
        );
        expect(result).toBe("10.0.0.50");
    });

    it("aggregates IPv4 across multiple interfaces", () => {
        const result = deriveLocalIp(
            ifaces(
                { name: "en0", addresses: [v6("fe80::1")] },
                { name: "en1", addresses: [ipv4("192.168.1.100")] },
            ),
            "192.168.1.1",
        );
        expect(result).toBe("192.168.1.100");
    });
});