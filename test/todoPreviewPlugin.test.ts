import { describe, it, expect, vi } from "vitest";
import { assertPluginContract } from "./pluginContract.shared";

vi.mock("vscode", () => ({}));

const { todoPreviewPlugin, TODO_PREVIEW_PLUGIN_ID } = await import(
    "../src/todoPreview/plugin"
);

describe("todoPreviewPlugin", () => {
    it("satisfies the ExtensionPlugin contract (with a markdown-it hook)", () => {
        assertPluginContract(todoPreviewPlugin, {
            id: TODO_PREVIEW_PLUGIN_ID,
            name: "Todo Preview",
            markdownHook: "function",
            deactivate: "absent",
        });
    });

    it("contributeMarkdownIt pushes a 'todo_section_wrap' ruler onto md.core", () => {
        const md = {
            core: { ruler: { push: vi.fn() } },
            renderer: { rules: {} },
        };
        const contribute = todoPreviewPlugin.contributeMarkdownIt!;
        const result = contribute(md as never);
        expect(md.core.ruler.push).toHaveBeenCalledWith(
            "todo_section_wrap",
            expect.any(Function)
        );
        // Hook returns the (mutated) md so the manager can chain.
        expect(result).toBe(md);
    });
});
