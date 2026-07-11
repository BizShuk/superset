import { describe, it, vi } from "vitest";
import { assertPluginContract } from "./pluginContract.shared";

// Minimal vscode mock — the modifiedFiles plugin chain imports
// `./treeProvider.ts` which references `TreeItemCollapsibleState` at
// module load time. We only check interface-level invariants here;
// full activation is exercised in the extension host.
vi.mock("vscode", () => ({
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
}));

const { modifiedFilesPlugin, MODIFIED_FILES_PLUGIN_ID } = await import(
    "../src/modifiedFiles/plugin"
);

describe("modifiedFilesPlugin", () => {
    it("satisfies the ExtensionPlugin interface contract", () => {
        assertPluginContract(modifiedFilesPlugin, {
            id: MODIFIED_FILES_PLUGIN_ID,
            name: "Modified Files",
            markdownHook: "absent",
            deactivate: "present",
        });
    });
});