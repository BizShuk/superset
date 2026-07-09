import { describe, it, expect, vi } from "vitest";

// Minimal vscode mock — the panelLayout plugin chain-imports
// `vscode.commands` (registerCommand, executeCommand), `setTimeout`
// scheduling, and our own storage helpers. We only check interface
// invariants here; full activate-flow testing is covered by the
// `panelLayoutStorage` and `panelLayoutRestoreView` test files.
vi.mock("vscode", () => ({
    commands: {
        registerCommand: () => ({ dispose: () => undefined }),
    },
}));

const { panelLayoutPlugin, PANEL_LAYOUT_PLUGIN_ID } = await import(
    "../src/panelLayout/plugin"
);

describe("panelLayoutPlugin", () => {
    it("exposes a stable id and name", () => {
        expect(panelLayoutPlugin.id).toBe(PANEL_LAYOUT_PLUGIN_ID);
        expect(panelLayoutPlugin.id).toBe("panelLayout");
        expect(panelLayoutPlugin.name).toBe("Panel Layout Persistence");
    });

    it("does not contribute a markdown-it hook", () => {
        expect(panelLayoutPlugin.contributeMarkdownIt).toBeUndefined();
    });

    it("defines an optional deactivate (lifecycle hint for the manager)", () => {
        expect(typeof panelLayoutPlugin.deactivate).toBe("function");
    });
});