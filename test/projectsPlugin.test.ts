import { describe, it, expect, vi } from "vitest";

// Minimal vscode mock — needed because the projects plugin adapter
// statically imports `./index.ts` which itself imports `vscode`. The
// test only checks interface-level invariants (id / name / hooks),
// not the legacy `register()` body.
vi.mock("vscode", () => ({}));

// Dynamic import keeps the chain resolving through the hoisted mock above.
const { projectsPlugin, PROJECTS_PLUGIN_ID } = await import("../src/projects/plugin");

describe("projectsPlugin", () => {
    it("exposes a stable id and name", () => {
        expect(projectsPlugin.id).toBe(PROJECTS_PLUGIN_ID);
        expect(projectsPlugin.name).toBe("Projects");
    });

    it("does not contribute a markdown-it hook", () => {
        expect(projectsPlugin.contributeMarkdownIt).toBeUndefined();
    });

    it("defines an optional deactivate", () => {
        expect(typeof projectsPlugin.deactivate).toBe("function");
    });
});
