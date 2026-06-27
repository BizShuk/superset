import { describe, it, expect } from "vitest";
import { networkKey, mergeServices } from "../src/mdns/mdnsDedup";
import type { MdnsService } from "../src/mdns/types";

describe("networkKey", () => {
    it("joins host/port/type with |", () => {
        expect(networkKey({ host: "h", port: 80, type: "_http._tcp" }))
            .toBe("h|80|_http._tcp");
    });
    it("uses first address when host missing", () => {
        expect(
            networkKey({
                host: undefined,
                addresses: ["1.2.3.4"],
                port: 22,
                type: "_ssh._tcp",
            })
        ).toBe("1.2.3.4|22|_ssh._tcp");
    });
    it("falls back to empty id when neither host nor addresses", () => {
        expect(networkKey({ port: 0, type: "_x._tcp" })).toBe("|0|_x._tcp");
    });
});

describe("mergeServices", () => {
    it("merges two services with same network key, keeping first name as canonical", () => {
        const a = {
            name: "printer",
            host: "p.local",
            port: 631,
            type: "_ipp._tcp",
            addresses: [],
        } as MdnsService;
        const b = {
            name: "printer-alt",
            host: "p.local",
            port: 631,
            type: "_ipp._tcp",
            addresses: [],
        } as MdnsService;
        const merged = mergeServices(a, b);
        expect(merged.name).toBe("printer");
        expect(merged.aliases).toEqual(["printer-alt"]);
    });

    it("unions addresses from both services", () => {
        const a = {
            name: "printer",
            host: "p.local",
            port: 631,
            type: "_ipp._tcp",
            addresses: ["10.0.0.1"],
        } as MdnsService;
        const b = {
            name: "printer-alt",
            host: "p.local",
            port: 631,
            type: "_ipp._tcp",
            addresses: ["10.0.0.2", "10.0.0.1"],
        } as MdnsService;
        const merged = mergeServices(a, b);
        expect(merged.addresses).toEqual(["10.0.0.1", "10.0.0.2"]);
    });

    it("accumulates aliases across multiple merges without duplicates", () => {
        const a = {
            name: "printer",
            aliases: ["printer-old"],
            host: "p.local",
            port: 631,
            type: "_ipp._tcp",
            addresses: [],
        } as MdnsService;
        const b = {
            name: "printer-alt",
            host: "p.local",
            port: 631,
            type: "_ipp._tcp",
            addresses: [],
        } as MdnsService;
        const merged = mergeServices(a, b);
        expect(merged.aliases).toEqual(["printer-old", "printer-alt"]);
    });

    it("takes the most recent lastSeen and earliest firstSeen", () => {
        const a = {
            name: "printer",
            host: "p.local",
            port: 631,
            type: "_ipp._tcp",
            addresses: [],
            firstSeen: 1000,
            lastSeen: 2000,
        } as MdnsService;
        const b = {
            name: "printer-alt",
            host: "p.local",
            port: 631,
            type: "_ipp._tcp",
            addresses: [],
            firstSeen: 500,
            lastSeen: 5000,
        } as MdnsService;
        const merged = mergeServices(a, b);
        expect(merged.firstSeen).toBe(500);
        expect(merged.lastSeen).toBe(5000);
    });

    it("unions subtypes and keeps the lower ttl", () => {
        const a = {
            name: "printer",
            host: "p.local",
            port: 631,
            type: "_ipp._tcp",
            addresses: [],
            ttl: 120,
            subtypes: ["_printer"],
        } as MdnsService;
        const b = {
            name: "printer-alt",
            host: "p.local",
            port: 631,
            type: "_ipp._tcp",
            addresses: [],
            ttl: 60,
            subtypes: ["_fax", "_printer"],
        } as MdnsService;
        const merged = mergeServices(a, b);
        expect(merged.ttl).toBe(60);
        expect(merged.subtypes).toEqual(["_printer", "_fax"]);
    });
});
