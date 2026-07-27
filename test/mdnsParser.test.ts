import { describe, it, expect } from "vitest";
import {
    applyAddress,
    applyPtr,
    applySrv,
    applyTxt,
    createMutableService,
    extractSubtype,
    freezeMutable,
    stripSubtype,
    trackMinTtl,
} from "../src/mdns/parser";

const NOW = 1_700_000_000_000;

describe("parser helpers", () => {
    it("trackMinTtl returns incoming when current is 0", () => {
        expect(trackMinTtl(0, 60)).toBe(60);
    });
    it("trackMinTtl returns min otherwise", () => {
        expect(trackMinTtl(120, 60)).toBe(60);
        expect(trackMinTtl(60, 120)).toBe(60);
    });
    it("extractSubtype picks out _xxx._sub segments", () => {
        expect(extractSubtype("_printer._sub._http._tcp")).toBe("_printer");
        expect(extractSubtype("_http._tcp")).toBeUndefined();
        expect(extractSubtype("_sub._http._tcp")).toBeUndefined(); // no leading _
    });
    it("stripSubtype removes _sub and what came before it", () => {
        expect(stripSubtype("_printer._sub._http._tcp")).toBe("_http._tcp");
        expect(stripSubtype("_http._tcp")).toBe("_http._tcp");
    });
});

describe("applyPtr", () => {
    it("stamps name/type/domain and tracks TTL + lastSeen", () => {
        const svc = createMutableService();
        applyPtr(
            { name: "_http._tcp.local", type: "PTR", ttl: 75, data: "Host._http._tcp.local" },
            svc,
            NOW
        );
        expect(svc.name).toBe("Host._http._tcp.local");
        expect(svc.type).toBe("_http._tcp");
        expect(svc.domain).toBe("local");
        expect(svc.ttl).toBe(75);
        expect(svc.lastSeen).toBe(NOW);
        expect(svc.firstSeen).toBe(NOW);
    });

    it("extracts subtypes and strips them from the type", () => {
        const svc = createMutableService();
        applyPtr(
            {
                name: "_printer._sub._http._tcp.local",
                type: "PTR",
                ttl: 60,
                data: "MFP._http._tcp.local",
            },
            svc,
            NOW
        );
        expect(svc.type).toBe("_http._tcp");
        expect(svc.subtypes).toEqual(["_printer"]);
    });

    it("ignores self-referential PTR (data === name)", () => {
        const svc = createMutableService();
        applyPtr(
            { name: "X", type: "PTR", ttl: 60, data: "X" },
            svc,
            NOW
        );
        expect(svc.name).toBe("");
    });

    it("ignores non-string data", () => {
        const svc = createMutableService();
        applyPtr(
            { name: "X", type: "PTR", ttl: 60, data: { not: "string" } },
            svc,
            NOW
        );
        expect(svc.name).toBe("");
    });

    it("ignores DNS names larger than 255 UTF-8 bytes", () => {
        const svc = createMutableService();
        applyPtr(
            {
                name: "_http._tcp.local",
                type: "PTR",
                ttl: 60,
                data: `${"é".repeat(128)}._http._tcp.local`,
            },
            svc,
            NOW
        );
        expect(svc.name).toBe("");
    });
});

describe("applySrv", () => {
    it("populates port, host, priority, weight, ttl", () => {
        const svc = createMutableService();
        applySrv(
            {
                name: "Host._http._tcp.local",
                type: "SRV",
                ttl: 120,
                data: { port: 8080, target: "host.local.", priority: 5, weight: 10 },
            },
            svc,
            NOW
        );
        expect(svc.port).toBe(8080);
        expect(svc.host).toBe("host.local");
        expect(svc.priority).toBe(5);
        expect(svc.weight).toBe(10);
        expect(svc.ttl).toBe(120);
    });

    it("skips records without numeric port", () => {
        const svc = createMutableService();
        applySrv(
            { name: "x", type: "SRV", ttl: 60, data: { target: "h.local" } },
            svc,
            NOW
        );
        expect(svc.port).toBe(0);
    });

    it("skips invalid ports and overlong targets", () => {
        const invalidPort = createMutableService();
        applySrv(
            {
                name: "x",
                type: "SRV",
                ttl: 60,
                data: { port: 65_536, target: "host.local" },
            },
            invalidPort,
            NOW
        );
        expect(invalidPort.port).toBe(0);

        const invalidTarget = createMutableService();
        applySrv(
            {
                name: "x",
                type: "SRV",
                ttl: 60,
                data: { port: 80, target: `${"a".repeat(256)}.local` },
            },
            invalidTarget,
            NOW
        );
        expect(invalidTarget.host).toBeUndefined();
        expect(invalidTarget.port).toBe(0);
    });
});

describe("applyTxt", () => {
    it("merges Record<string,string> txt into existing", () => {
        const svc = createMutableService();
        svc.txt = { a: "1" };
        applyTxt(
            { name: "x", type: "TXT", ttl: 60, data: { b: "2" } },
            svc,
            NOW
        );
        expect(svc.txt).toEqual({ a: "1", b: "2" });
    });

    it("parses length-prefixed binary format", () => {
        // 1 byte: length 3, then 3 bytes "k=v"
        const buf = Buffer.from([3, ...Buffer.from("k=v")]);
        const svc = createMutableService();
        applyTxt({ name: "x", type: "TXT", ttl: 60, data: buf }, svc, NOW);
        expect(svc.txt).toEqual({ k: "v" });
    });

    it("bounds TXT entry count and rejects oversized keys and values", () => {
        const svc = createMutableService();
        const data = Object.fromEntries([
            ...Array.from({ length: 70 }, (_, index) => [
                `key-${index}`,
                `value-${index}`,
            ]),
            ["k".repeat(129), "oversized-key"],
            ["oversized-value", "v".repeat(1025)],
        ]);

        applyTxt({ name: "x", type: "TXT", ttl: 60, data }, svc, NOW);

        expect(Object.keys(svc.txt)).toHaveLength(64);
        expect(svc.txt).not.toHaveProperty("k".repeat(129));
        expect(svc.txt).not.toHaveProperty("oversized-value");
    });
});

describe("applyAddress", () => {
    it("appends to matching service by host and to hostname entry", () => {
        const map = new Map<string, ReturnType<typeof createMutableService>>();
        const svc = createMutableService();
        svc.name = "X._http._tcp.local";
        svc.host = "host.local";
        map.set("X._http._tcp.local", svc);
        const hostEntry = createMutableService();
        map.set("host.local", hostEntry);

        applyAddress(
            { name: "host.local.", type: "A", ttl: 60, data: "10.0.0.1" },
            map,
            NOW
        );

        expect(svc.addresses).toEqual(["10.0.0.1"]);
        expect(hostEntry.addresses).toEqual(["10.0.0.1"]);
    });

    it("does not duplicate an address", () => {
        const map = new Map<string, ReturnType<typeof createMutableService>>();
        const svc = createMutableService();
        svc.host = "host.local";
        svc.addresses = ["10.0.0.1"];
        map.set("X", svc);

        applyAddress(
            { name: "host.local.", type: "A", ttl: 60, data: "10.0.0.1" },
            map,
            NOW
        );

        expect(svc.addresses).toEqual(["10.0.0.1"]);
    });

    it("retains at most 32 valid IP addresses", () => {
        const map = new Map<string, ReturnType<typeof createMutableService>>();
        const svc = createMutableService();
        svc.host = "host.local";
        map.set("X", svc);

        for (let index = 1; index <= 40; index += 1) {
            applyAddress(
                {
                    name: "host.local.",
                    type: "A",
                    ttl: 60,
                    data: `10.0.0.${index}`,
                },
                map,
                NOW
            );
        }
        applyAddress(
            {
                name: "host.local.",
                type: "A",
                ttl: 60,
                data: "not-an-ip",
            },
            map,
            NOW
        );

        expect(svc.addresses).toHaveLength(32);
        expect(svc.addresses).not.toContain("not-an-ip");
    });
});

describe("freezeMutable", () => {
    it("deep-copies arrays/records so callers can't mutate store internals", () => {
        const s = createMutableService();
        s.name = "x";
        s.addresses = ["a"];
        s.txt = { k: "v" };
        const frozen = freezeMutable(s);
        frozen.addresses.push("b");
        (frozen.txt as Record<string, string>).k2 = "v2";
        expect(s.addresses).toEqual(["a"]);
        expect(s.txt).toEqual({ k: "v" });
    });
});
