// Shared assertions for the per-plugin interface-contract tests.
//
// `todoPlugin`, `mdnsPlugin`, `terminalsPlugin`, `topologyPlugin`,
// `projectsPlugin`, and `todoPreviewPlugin` each had a hand-written
// copy of the same three checks: stable id, human-readable name, and
// an optional `deactivate` lifecycle method. This helper collapses
// the duplication so each test file shrinks to a dynamic import plus a
// single `assertPluginContract(...)` call.
//
// `treePreviewPlugin` is intentionally NOT a consumer — its test
// exercises real fence-rendering behaviour, not just the contract.
//
// Each caller still owns its own `vi.mock("vscode", ...)` + dynamic
// import: the import path differs per file, so that boilerplate cannot
// be hoisted into the helper.

import { expect } from "vitest";
import type { ExtensionPlugin } from "../src/plugin";

export interface PluginContractExpectations {
    /** Expected `plugin.id` (matches the exported `<NAME>_PLUGIN_ID`). */
    readonly id: string;
    /** Expected `plugin.name`. */
    readonly name: string;
    /**
     * What `plugin.contributeMarkdownIt` should be. The five panel
     * plugins contribute no markdown-it hook (`undefined`); the
     * `todoPreviewPlugin` contributes one (`"function"`). Callers that
     * need to assert deeper hook behaviour keep that in their own file.
     */
    readonly markdownHook: "absent" | "function";
    /**
     * Whether the plugin defines a `deactivate` lifecycle method. The
     * five panel shims do (a no-op body, but present so the manager
     * has a teardown hint); the markdown-preview-only plugins
     * (`treePreview`, `todoPreview`) omit it entirely since their only
     * contribution is a markdown-it hook with no long-lived state.
     */
    readonly deactivate: "present" | "absent";
}

/**
 * Assert the stable interface invariants every `ExtensionPlugin` shim
 * must satisfy. Shared across the six per-plugin contract tests.
 */
export function assertPluginContract(
    plugin: ExtensionPlugin,
    expected: PluginContractExpectations
): void {
    expect(plugin.id).toBe(expected.id);
    expect(plugin.name).toBe(expected.name);

    if (expected.markdownHook === "absent") {
        expect(plugin.contributeMarkdownIt).toBeUndefined();
    } else {
        expect(typeof plugin.contributeMarkdownIt).toBe("function");
    }

    if (expected.deactivate === "present") {
        expect(typeof plugin.deactivate).toBe("function");
    } else {
        expect(plugin.deactivate).toBeUndefined();
    }
}
