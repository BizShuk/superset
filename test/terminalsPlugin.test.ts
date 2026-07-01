import { describe, it, expect, vi } from "vitest";

// Minimal vscode mock — the terminals plugin chain imports `./index.ts`
// which reaches for vscode surface. We only check interface-level
// invariants here; full activation is exercised in the extension host.
vi.mock("vscode", () => ({}));

const { terminalsPlugin, TERMINALS_PLUGIN_ID } = await import(
    "../src/terminals/plugin"
);

describe("terminalsPlugin", () => {
    it("exposes a stable id and name", () => {
        expect(terminalsPlugin.id).toBe(TERMINALS_PLUGIN_ID);
        expect(terminalsPlugin.name).toBe("Terminals");
    });

    it("does not contribute a markdown-it hook", () => {
        expect(terminalsPlugin.contributeMarkdownIt).toBeUndefined();
    });

    it("defines an optional deactivate (lifecycle hint for the manager)", () => {
        expect(typeof terminalsPlugin.deactivate).toBe("function");
    });
});
