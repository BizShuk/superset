import { describe, it, vi } from "vitest";
import { assertPluginContract } from "./pluginContract.shared";

// Minimal vscode mock — needed because the projects plugin adapter
// statically imports `./index.ts` which itself imports `vscode`. The
// test only checks interface-level invariants (id / name / hooks),
// not the legacy `register()` body.
vi.mock("vscode", () => ({}));

// Dynamic import keeps the chain resolving through the hoisted mock above.
const { projectsPlugin, PROJECTS_PLUGIN_ID } = await import("../src/projects/plugin");

describe("projectsPlugin", () => {
    it("satisfies the ExtensionPlugin contract", () => {
        assertPluginContract(projectsPlugin, {
            id: PROJECTS_PLUGIN_ID,
            name: "Projects",
            markdownHook: "absent",
            deactivate: "present",
        });
    });
});
