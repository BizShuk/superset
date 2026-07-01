import { describe, it, expect, vi } from "vitest";

// Minimal vscode mock — needed because the todo plugin adapter
// statically imports `./index.ts` which itself imports `vscode`. The
// test only checks interface-level invariants (id / name / hooks),
// not the legacy `register()` body; full activation is exercised
// inside the VSCode extension host and will be revisited at Stage 6.
vi.mock("vscode", () => ({}));

// Dynamic import keeps the chain (`plugin.ts` -> `index.ts` -> `vscode`)
// resolving through the hoisted mock above at test-load time, instead
// of failing static resolution up front.
const { todoPlugin, TODO_PLUGIN_ID } = await import("../src/todo/plugin");

describe("todoPlugin", () => {
    it("exposes a stable id and name", () => {
        expect(todoPlugin.id).toBe(TODO_PLUGIN_ID);
        expect(todoPlugin.name).toBe("TODO");
    });

    it("does not contribute a markdown-it hook", () => {
        expect(todoPlugin.contributeMarkdownIt).toBeUndefined();
    });

    it("defines an optional deactivate (lifecycle hint for the manager)", () => {
        expect(typeof todoPlugin.deactivate).toBe("function");
    });
});
