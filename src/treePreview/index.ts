import { renderLine, type MarkdownItLike } from "./renderLine";

/**
 * The object VSCode's built-in Markdown preview expects an extension to
 * return from `activate()` when it declares `markdown.markdownItPlugins`.
 */
export interface MarkdownItExtension {
    extendMarkdownIt(md: any): any;
}

/**
 * Build the markdown-it extension that renders ```` ```tree ```` fenced
 * blocks with directory/file icons and connector styling.
 *
 * Unlike the other features this one does not register a TreeView or any
 * disposables — its contribution is purely the markdown-it hook surfaced
 * through the composition root's `activate()` return value.
 */
export function createTreePreviewExtension(): MarkdownItExtension {
    return {
        extendMarkdownIt(md: any) {
            const mdLike = md as MarkdownItLike;
            const defaultFence = md.renderer.rules.fence;

            md.renderer.rules.fence = (
                tokens: any[],
                idx: number,
                options: any,
                env: any,
                self: any
            ) => {
                const token = tokens[idx];
                if (token.info.trim() === "tree") {
                    const lines = token.content
                        .replace(/\n$/, "")
                        .split("\n");
                    const rows = lines
                        .map((l: string) => renderLine(mdLike, l))
                        .join("\n");
                    return `<pre class="tree-block"><code>${rows}</code></pre>\n`;
                }
                return defaultFence
                    ? defaultFence(tokens, idx, options, env, self)
                    : `<pre><code>${md.utils.escapeHtml(token.content)}</code></pre>`;
            };

            return md;
        },
    };
}
