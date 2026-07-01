// TodoParser — pure Markdown <-> AST transforms. No I/O, no VSCode
// dependency, fully unit-testable. The store hands the parser a raw
// string and receives a `TodoItem[]` back; the actual file reads and
// writes are handled by `TodoRepository` (see `repository.ts`).
//
// This module is the *extract* of the parsing logic that used to live
// inside `TodoStore.load()`. Behaviour is identical — line indices
// still map 1:1 to the input string's split('\n') so callers can
// locate the source line for any emitted `TodoItem`.

import type { TodoItem } from "./types";

/** Pattern for `- [ ]` / `- [x]` actionable checkboxes. */
const CHECKBOX_RE = /^(\s*)[-*+]\s+\[(\s|x|X)\]\s+(.*)$/;
/** Pattern for bare list markers `- foo` / `* bar` / `+ baz`. */
const BARE_LIST_RE = /^(\s*)[-*+]\s+(\S.*)$/;
/** Pattern for `## Section` / `### Subsection` headings. */
const HEADING_RE = /^(##+)\s+(.*)$/;

const DEFAULT_SECTION_TEXT = "Default";

/**
 * Parse a `README.todo` file's contents into the structured `TodoItem[]`
 * the tree view consumes. A synthetic "Default" section is prepended
 * for any checkbox / list items that appear *before* the first
 * `## ...` heading (or in a file with no headings at all).
 *
 * The function preserves the line index for every emitted item so the
 * store can round-trip writes back to the same line.
 */
export function parseTodoFile(content: string): TodoItem[] {
    const lines = content.split("\n");
    const sections: TodoItem[] = [];
    const defaultSection: TodoItem = {
        line: -1,
        text: DEFAULT_SECTION_TEXT,
        kind: "section",
        checked: false,
        children: [],
    };
    let currentSection: TodoItem = defaultSection;
    const stack: { item: TodoItem; indent: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;

        // 0. Heading — opens a new section.
        const hm = line.match(HEADING_RE);
        if (hm) {
            const sectionItem: TodoItem = {
                line: i,
                text: hm[2]!.trim(),
                kind: "section",
                checked: false,
                children: [],
            };
            sections.push(sectionItem);
            currentSection = sectionItem;
            stack.length = 0;
            continue;
        }

        // 1. Checkbox line.
        const cm = line.match(CHECKBOX_RE);
        if (cm) {
            const indent = cm[1]!.length;
            const item: TodoItem = {
                line: i,
                text: cm[3]!.trim(),
                kind: "checkbox",
                checked: cm[2]!.toLowerCase() === "x",
            };
            attachToParent(item, indent, stack, currentSection);
            stack.push({ item, indent });
            continue;
        }

        // 2. Bare list marker.
        const lm = line.match(BARE_LIST_RE);
        if (lm) {
            const indent = lm[1]!.length;
            const item: TodoItem = {
                line: i,
                text: lm[2]!.trim(),
                kind: "list",
                checked: false,
            };
            attachToParent(item, indent, stack, currentSection);
            // Push with indent+1 so a sibling at the same indent does not
            // become a child — mirrors the original `load()` behaviour.
            stack.push({ item, indent: indent + 1 });
        }
    }

    const finalItems: TodoItem[] = [];
    if (defaultSection.children && defaultSection.children.length > 0) {
        finalItems.push(defaultSection);
    }
    finalItems.push(...sections);
    return finalItems;
}

function attachToParent(
    item: TodoItem,
    indent: number,
    stack: { item: TodoItem; indent: number }[],
    currentSection: TodoItem
): void {
    while (
        stack.length > 0 &&
        stack[stack.length - 1]!.indent >= indent
    ) {
        stack.pop();
    }
    if (stack.length > 0) {
        const parent = stack[stack.length - 1]!.item;
        if (!parent.children) parent.children = [];
        parent.children.push(item);
    } else {
        if (!currentSection.children) currentSection.children = [];
        currentSection.children.push(item);
    }
}
