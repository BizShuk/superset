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
        const sections: TodoItem[] = [];
        const defaultSection: TodoItem = {
            line: -1,
            text: "Default",
            kind: "section",
            checked: false,
            children: [],
        };
        let currentSection = defaultSection;

        // `- [ ]` / `- [x]` — actionable checkbox.
        const checkboxRe = /^(\s*)[-*+]\s+\[(\s|x|X)\]\s+(.*)$/;
        // `- foo` / `* bar` / `+ baz` (without `[ ]`).
        const listRe = /^(\s*)[-*+]\s+(\[[^\]]\s*[^\]]*\](.*))?$/;
        const headingRe = /^(##+)\s+(.*)$/;
        const stack: { item: TodoItem; indent: number }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 0. Heading line?
            const hm = line.match(headingRe);
            if (hm) {
                const sectionItem: TodoItem = {
                    line: i,
                    text: hm[2].trim(),
                    kind: "section",
                    checked: false,
                    children: [],
                };
                sections.push(sectionItem);
                currentSection = sectionItem;
                stack.length = 0;
                continue;
            }

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
                    if (!currentSection.children) currentSection.children = [];
                    currentSection.children.push(item);
                }

                stack.push({ item, indent });
                continue;
            }

            // 2. Bare list marker?
            const lm = line.match(/^(\s*)[-*+]\s+(\S.*)$/);
            if (lm) {
                const indent = lm[1].length;
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
                    if (!currentSection.children) currentSection.children = [];
                    currentSection.children.push(item);
                }

                stack.push({ item, indent: indent + 1 });
            }
        }
        const finalItems: TodoItem[] = [];
        if (defaultSection.children && defaultSection.children.length > 0) {
            finalItems.push(defaultSection);
        }
        finalItems.push(...sections);
        this.items = finalItems;
        this.emit({ type: "loaded", items: finalItems });
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

    async updatePriority(item: TodoItem, newPriority: "P0" | "P1" | "P2"): Promise<void> {
        const filePath = `${this.workspaceRoot}/${TODO_FILE}`;
        let content: string;
        try {
            content = await readFile(filePath, "utf-8");
        } catch {
            return;
        }

        const lines = content.split("\n");
        if (item.line >= lines.length) return;

        // Path 1: line already has a priority tag — replace it.
        const replaceRe = /^(\s*[-*+]\s+(?:\[[^\]]*\]\s+)?)(?:\[|\()P[0-2](?:\]|\))(\s+.*)$/;
        const m = lines[item.line].match(replaceRe);
        if (m) {
            lines[item.line] = `${m[1]}[${newPriority}]${m[2]}`;
        } else {
            // Path 2: no priority prefix — insert `[Px] ` after the
            // optional checkbox marker.
            const insertRe = /^(\s*[-*+]\s+(?:\[[^\]]*\]\s+)?)(\S.*)$/;
            const im = lines[item.line].match(insertRe);
            if (!im) return;
            lines[item.line] = `${im[1]}[${newPriority}] ${im[2]}`;
        }
        await writeFile(filePath, lines.join("\n"), "utf-8");

        // Reload so the in-memory `items` reflect the new prefix. The file
        // is the source of truth; we don't mutate `item.text` (it's readonly).
        // Emitting "loaded" makes TodoTreeProvider re-render with fresh data.
        await this.load();
    }

    async addTodo(text: string, sectionName: string): Promise<void> {
        const filePath = `${this.workspaceRoot}/${TODO_FILE}`;
        let content: string;
        try {
            content = await readFile(filePath, "utf-8");
        } catch {
            content = "# TODO\n";
        }

        const lines = content.split("\n");
        let targetLineIndex = -1;
        const isDefaultSection = sectionName.toLowerCase() === "default";

        if (isDefaultSection) {
            // Find `# TODO` or first heading
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim().startsWith("# ")) {
                    targetLineIndex = i;
                    break;
                }
            }
        } else {
            // Find `## sectionName` or `### sectionName`
            const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const sectionRe = new RegExp(`^(##+)\\s+${escapedName}\\b`, "i");
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].match(sectionRe)) {
                    targetLineIndex = i;
                    break;
                }
            }
        }

        if (targetLineIndex === -1) {
            // Section does not exist. Append to the end.
            if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
                lines.push("");
            }
            if (isDefaultSection) {
                lines.push(`- [ ] ${text}`);
            } else {
                lines.push(`## ${sectionName}`);
                lines.push(`- [ ] ${text}`);
            }
        } else {
            // Section exists. Find the end of the section.
            let insertIndex = lines.length;
            for (let i = targetLineIndex + 1; i < lines.length; i++) {
                if (lines[i].trim().startsWith("##") || lines[i].trim().startsWith("###")) {
                    insertIndex = i;
                    break;
                }
            }

            // Find the last non-empty line before insertIndex.
            let lastNonEmpty = insertIndex - 1;
            while (lastNonEmpty > targetLineIndex && lines[lastNonEmpty].trim() === "") {
                lastNonEmpty--;
            }

            if (lastNonEmpty === targetLineIndex) {
                // Empty section: insert a blank line, then the item.
                lines.splice(targetLineIndex + 1, 0, "", `- [ ] ${text}`);
            } else {
                // Has items: insert directly after the last item.
                lines.splice(lastNonEmpty + 1, 0, `- [ ] ${text}`);
            }
        }

        await writeFile(filePath, lines.join("\n"), "utf-8");
        await this.load();
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