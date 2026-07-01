import { describe, it, expect, vi } from "vitest";

// Minimal vscode mock — the mdns plugin chain imports `./index.ts`
// which reaches for vscode surface. We only check interface-level
// invariants here; full activation is exercised in the extension host.
vi.mock("vscode", () => ({}));

const { mdnsPlugin, MDNS_PLUGIN_ID } = await import("../src/mdns/plugin");

describe("mdnsPlugin", () => {
    it("exposes a stable id and name", () => {
        expect(mdnsPlugin.id).toBe(MDNS_PLUGIN_ID);
        expect(mdnsPlugin.name).toBe("mDNS");
    });

    it("does not contribute a markdown-it hook", () => {
        expect(mdnsPlugin.contributeMarkdownIt).toBeUndefined();
    });

    it("defines an optional deactivate (lifecycle hint for the manager)", () => {
        expect(typeof mdnsPlugin.deactivate).toBe("function");
    });
});
