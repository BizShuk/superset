import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({}));

const { todoPreviewPlugin, TODO_PREVIEW_PLUGIN_ID } = await import(
    "../src/todoPreview/plugin"
);

describe("todoPreviewPlugin", () => {
    it("exposes a stable id and name", () => {
        expect(todoPreviewPlugin.id).toBe(TODO_PREVIEW_PLUGIN_ID);
        expect(todoPreviewPlugin.name).toBe("Todo Preview");
    });

    it("contributes a markdown-it hook", () => {
        expect(typeof todoPreviewPlugin.contributeMarkdownIt).toBe("function");
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
