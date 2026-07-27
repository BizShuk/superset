// Tests for the pure `resolveConnectCommand` helper used by the
// mDNS one-click-connect command. No `vscode` dependency — runs in
// vitest without any mock.

import { describe, expect, it } from "vitest";
import { resolveConnectCommand } from "../src/mdnsConnect";

const baseSvc = {
    name: "pi@nas",
    host: "nas.local",
    addresses: ["192.168.1.10"],
    port: 22,
    type: "_ssh._tcp",
} as const;

describe("resolveConnectCommand", () => {
    it("returns ssh for _ssh services", () => {
        const r = resolveConnectCommand(baseSvc);
        expect(r).toEqual({
            kind: "terminal",
            cmd: "ssh",
            args: ["pi@nas.local"],
        });
    });

    it("returns ssh for _sftp services", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            type: "_sftp._tcp",
        });
        expect(r).toMatchObject({ kind: "terminal", cmd: "ssh" });
    });

    it("returns an external URI for _http services", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            name: "router",
            type: "_http._tcp",
            port: 80,
        });
        expect(r).toEqual({
            kind: "external",
            uri: "http://nas.local:80",
        });
    });

    it("returns an external URI with https for _https services", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            type: "_https._tcp",
            port: 8443,
        });
        expect(r).toEqual({
            kind: "external",
            uri: "https://nas.local:8443",
        });
    });

    it("returns an external URI with ipp for _ipp services", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            name: "printer",
            type: "_ipp._tcp",
            port: 631,
        });
        expect(r).toEqual({
            kind: "external",
            uri: "ipp://nas.local:631",
        });
    });

    it("brackets an IPv6 address used in an external URI", () => {
        expect(
            resolveConnectCommand({
                ...baseSvc,
                name: "router",
                host: undefined,
                addresses: ["2001:db8::1"],
                type: "_https._tcp",
                port: 443,
            })
        ).toEqual({
            kind: "external",
            uri: "https://[2001:db8::1]:443",
        });
    });

    it("returns null when host is missing (cannot connect)", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            host: undefined,
            addresses: [],
        });
        expect(r).toBeNull();
    });

    it("falls back to address when host is missing", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            host: undefined,
            addresses: ["10.0.0.5"],
        });
        expect(r).toEqual({
            kind: "terminal",
            cmd: "ssh",
            args: ["pi@10.0.0.5"],
        });
    });

    it("returns null for unknown service types", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            type: "_custom._tcp",
        });
        expect(r).toBeNull();
    });

    it.each([
        "x & touch /tmp/pwned@nas",
        "x; open https://evil.invalid@nas",
        "x\nwhoami@nas",
        "-oProxyCommand=whoami@nas",
        "x$(whoami)@nas",
    ])("rejects an unsafe SSH instance name: %s", (name) => {
        expect(resolveConnectCommand({ ...baseSvc, name })).toBeNull();
    });

    it.each([
        "nas.local;whoami",
        "nas.local\nwhoami",
        "-oProxyCommand=whoami",
        "nas local",
        "a..local",
    ])("rejects an invalid target: %s", (host) => {
        expect(resolveConnectCommand({ ...baseSvc, host })).toBeNull();
    });

    it.each([0, -1, 65536, 22.5, Number.NaN, Number.POSITIVE_INFINITY])(
        "rejects an invalid port: %s",
        (port) => {
            expect(resolveConnectCommand({ ...baseSvc, port })).toBeNull();
        }
    );
});
