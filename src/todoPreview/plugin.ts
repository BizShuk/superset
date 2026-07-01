// todoPreviewPlugin — `ExtensionPlugin` adapter for the
// `README.todo` markdown preview. The actual hook logic still lives
// in `./index.ts` as a plain `createTodoPreviewExtension()` factory
// (unchanged). This adapter exposes the same hook via
// `contributeMarkdownIt` so the `PluginManager` collects it
// alongside the `treePreview` plugin's hook and `activate()` returns
// the merged chain.

import {
    type ExtensionPlugin,
    type PluginContext,
} from "../plugin";
import { createTodoPreviewExtension } from "./index";

export const TODO_PREVIEW_PLUGIN_ID = "todoPreview";

export const todoPreviewPlugin: ExtensionPlugin = {
    id: TODO_PREVIEW_PLUGIN_ID,
    name: "Todo Preview",
    // The plugin contributes no TreeView / command / disposable. The
    // markdown-it hook is collected by the manager automatically via
    // `getMarkdownExtension()`.
    activate(_ctx: PluginContext): void {
        _ctx.log("todoPreview: registered (markdown-it hook only)");
    },
    contributeMarkdownIt: ((md: Parameters<ReturnType<typeof createTodoPreviewExtension>["extendMarkdownIt"]>[0]) => {
        // Delegate to the legacy factory so the behaviour stays in
        // one place; the manager composes our return with other
        // plugins' contributions in activation order.
        return createTodoPreviewExtension().extendMarkdownIt(md);
    }) as NonNullable<ExtensionPlugin["contributeMarkdownIt"]>,
};
