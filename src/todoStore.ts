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
        const re = /^(\s*)[-*+]\s+\[(\s|x|X)\]\s+(.*)$/;
        const stack: { item: TodoItem; indent: number }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(re);
            if (m) {
                const indent = m[1].length;
                const item: TodoItem = {
                    line: i,
                    text: m[3].trim(),
                    checked: m[2].toLowerCase() === "x",
                };

                while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
                    stack.pop();
                }

                if (stack.length > 0) {
                    const parent = stack[stack.length - 1].item;
                    if (!parent.children) {
                        parent.children = [];
                    }
                    parent.children.push(item);
                } else {
                    items.push(item);
                }

                stack.push({ item, indent });
            }
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