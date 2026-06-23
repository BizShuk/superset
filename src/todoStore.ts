import { readFile, writeFile } from "fs/promises";
import type { TodoChange, TodoItem, TodoListener } from "./types";

const TODO_FILE = "README.todo";

/**
 * Pure data layer for the TODO list.
 * Reads/Writes a markdown file with checkbox items.
 * Uses the observer pattern (same as TerminalRegistry).
 */
export class TodoStore {
    private items: TodoItem[] = [];
    private listeners = new Set<TodoListener>();
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    getItems(): TodoItem[] {
        return this.items;
    }

    getCompletedCount(): number {
        let count = 0;
        const traverse = (items: TodoItem[]) => {
            for (const item of items) {
                if (item.checked) count++;
                if (item.children) traverse(item.children);
            }
        };
        traverse(this.items);
        return count;
    }

    async load(): Promise<void> {
        const filePath = `${this.workspaceRoot}/${TODO_FILE}`;
        let content: string;
        try {
            content = await readFile(filePath, "utf-8");
        } catch {
            this.items = [];
            this.emit({ type: "loaded", items: [] });
            return;
        }

        const lines = content.split("\n");
        const items: TodoItem[] = [];
        // `- [ ]` / `- [x]` — actionable checkbox.
        const checkboxRe = /^(\s*)[-*+]\s+\[(\s|x|X)\]\s+(.*)$/;
        // `- foo` / `* bar` / `+ baz` (without `[ ]`). Capture group 1
        // is the leading list marker so we can strip it from the
        // visible text. Use a negative lookahead to avoid matching
        // checkbox lines (those are already handled above).
        const listRe = /^(\s*)[-*+]\s+(\[[^\]]\s*[^\]]*\](.*))?$/;
        const stack: { item: TodoItem; indent: number }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 1. Checkbox line?
            const cm = line.match(checkboxRe);
            if (cm) {
                const indent = cm[1].length;
                const item: TodoItem = {
                    line: i,
                    text: cm[3].trim(),
                    kind: "checkbox",
                    checked: cm[2].toLowerCase() === "x",
                };

                while (
                    stack.length > 0 &&
                    stack[stack.length - 1].indent >= indent
                ) {
                    stack.pop();
                }

                if (stack.length > 0) {
                    const parent = stack[stack.length - 1].item;
                    if (!parent.children) parent.children = [];
                    parent.children.push(item);
                } else {
                    items.push(item);
                }

                stack.push({ item, indent });
                continue;
            }

            // 2. Bare list marker? A line that starts with `- ` / `* `
            // /    `+ ` and is NOT followed by a checkbox is treated
            // as a list-only node. Headings (`#`), quotes (`>`), and
            // plain text are all skipped.
            //
            // The regex intentionally rejects `[` after the marker so
            // we never re-match a checkbox line we already handled.
            const lm = line.match(/^(\s*)[-*+]\s+(\S.*)$/);
            if (lm) {
                const indent = lm[1].length;
                // Strip the leading list marker from the text shown
                // in the panel (a `- foo` line should read as "foo",
                // matching how a real checkbox line's text is just
                // the words after the `[ ]`).
                const item: TodoItem = {
                    line: i,
                    text: lm[2].trim(),
                    kind: "list",
                    checked: false,
                };

                while (
                    stack.length > 0 &&
                    stack[stack.length - 1].indent >= indent
                ) {
                    stack.pop();
                }

                if (stack.length > 0) {
                    const parent = stack[stack.length - 1].item;
                    if (!parent.children) parent.children = [];
                    parent.children.push(item);
                } else {
                    items.push(item);
                }

                // Push the list node into the stack using a strictly
                // positive indent so a *less* indented checkbox
                // below still pops it off (preserving the file's
                // visual nesting). We use indent+1 so a same-indent
                // checkbox doesn't get nested under the list node.
                stack.push({ item, indent: indent + 1 });
            }
            // 3. Anything else (heading, quote, plain text, blank)
            //    is ignored.
        }
        this.items = items;
        this.emit({ type: "loaded", items });
    }

    async toggle(item: TodoItem): Promise<void> {
        const filePath = `${this.workspaceRoot}/${TODO_FILE}`;
        let content: string;
        try {
            content = await readFile(filePath, "utf-8");
        } catch {
            return;
        }

        const lines = content.split("\n");
        if (item.line >= lines.length) return;

        const re = /^(\s*[-*+]\s+)\[(\s|x|X)\](\s+.*)$/;
        const m = lines[item.line].match(re);
        if (!m) return;

        const isDone = m[2].toLowerCase() === "x";
        const newMarker = isDone ? " " : "x";
        lines[item.line] = `${m[1]}[${newMarker}]${m[3]}`;

        await writeFile(filePath, lines.join("\n"), "utf-8");

        item.checked = !item.checked;
        this.emit({ type: "toggled", item });
    }

    onDidChange(listener: TodoListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(change: TodoChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }
}