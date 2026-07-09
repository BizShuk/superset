// TreePreview plugin adapter — exposes a fence-rule hook that highlights
// `tree` code blocks in the Markdown preview. Registered through the
// `ExtensionPlugin` contract so it can flow through `PluginManager`
// alongside future feature plugins. Behaviour is unchanged: the manager
// collects this plugin's `contributeMarkdownIt` and the composition
// root forwards the merged chain to VSCode's Markdown preview.

import { renderLine, type MarkdownItLike } from "./renderLine";
import type { ExtensionPlugin, MarkdownIt, PluginContext } from "../plugin";

export const TREE_PREVIEW_PLUGIN_ID = "treePreview";

/**
 * The fence-rule contract matches the loose `MarkdownIt` declared in
 * `plugin/types.ts`; the preview plugin only touches `renderer.rules.fence`
 * and `utils.escapeHtml`, both of which are typed.
 */
function buildFenceHook(): NonNullable<ExtensionPlugin["contributeMarkdownIt"]> {
    return (md: MarkdownIt) => {
        const mdLike = md as unknown as MarkdownItLike;
        const defaultFence = md.renderer.rules.fence;
        const utils = md.utils;

        md.renderer.rules.fence = (
            tokens: unknown[],
            idx: number,
            options: unknown,
            env: unknown,
            self: unknown
        ): string => {
            const token = tokens[idx] as { info: string; content: string };
            if (token.info.trim() === "tree") {
                const lines = token.content.replace(/\n$/, "").split("\n");
                const rows = lines
                    .map((l: string) => renderLine(mdLike, l))
                    .join("\n");
                return `<pre class="tree-block"><code>${rows}</code></pre>\n`;
            }
            if (defaultFence) {
                return (defaultFence as Function)(
                    tokens,
                    idx,
                    options,
                    env,
                    self
                );
            }
            return `<pre><code>${utils.escapeHtml(token.content)}</code></pre>`;
        };

        return md;
    };
}

export const treePreviewPlugin: ExtensionPlugin = {
    id: TREE_PREVIEW_PLUGIN_ID,
    name: "Tree Preview",
    // No long-lived disposables, no reset logic — this plugin's only
    // contribution is a markdown-it hook, which the manager composes
    // via `contributeMarkdownIt`. `activate` is a no-op kept to
    // satisfy the contract; logging presence helps diagnostic output.
    activate(_ctx: PluginContext): void {
        _ctx.log("treePreview: registered (markdown-it hook only)");
    },
    contributeMarkdownIt: buildFenceHook(),
};
