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
        expect(r).toEqual({ cmd: "ssh", args: ["pi@nas.local"] });
    });

    it("returns ssh for _sftp services", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            type: "_sftp._tcp",
        });
        expect(r?.cmd).toBe("ssh");
    });

    it("returns open for _http services", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            name: "router",
            type: "_http._tcp",
            port: 80,
        });
        expect(r).toEqual({
            cmd: "open",
            args: ["http://nas.local:80"],
        });
    });

    it("returns open with https for _https services", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            type: "_https._tcp",
            port: 8443,
        });
        expect(r).toEqual({
            cmd: "open",
            args: ["https://nas.local:8443"],
        });
    });

    it("returns open with ipp for _ipp services", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            name: "printer",
            type: "_ipp._tcp",
            port: 631,
        });
        expect(r).toEqual({
            cmd: "open",
            args: ["ipp://nas.local:631"],
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
        expect(r).toEqual({ cmd: "ssh", args: ["pi@10.0.0.5"] });
    });

    it("returns null for unknown service types", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            type: "_custom._tcp",
        });
        expect(r).toBeNull();
    });
});