import type { MarkdownItExtension } from "../treePreview";
import { wrapSections, type TokenLike, type TokenFactory } from "./sectionWrap";

/**
 * Build the markdown-it extension that restructures a `README.todo`-style
 * document (first heading `# TODO`) for the built-in Markdown preview:
 * collapsible sections + a sticky filter bar to hide completed/archived items.
 *
 * Like `treePreview` this contributes nothing but a `extendMarkdownIt` hook —
 * no TreeView, no command, no disposable. The behaviour lives entirely in
 * styles/todo-preview.css (declared via `markdown.previewStyles`).
 */
export function createTodoPreviewExtension(): MarkdownItExtension {
    return {
        extendMarkdownIt(md: any) {
            md.core.ruler.push("todo_section_wrap", (state: any) => {
                const make: TokenFactory = (type, tag, nesting) =>
                    new state.Token(type, tag, nesting) as TokenLike;
                state.tokens = wrapSections(
                    state.tokens as TokenLike[],
                    make
                );
                return true;
            });
            return md;
        },
    };
}
