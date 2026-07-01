// TodoStore — pure in-memory state holder. Owns the parsed `TodoItem[]`
// snapshot and an observer-pattern listener set. All filesystem I/O
// flows through `TodoRepository`; the parsing algorithm lives in
// `./parser`. The store's public surface is unchanged from before
// the refactor — see the existing 23-case test suite for the contract.

import type { TodoChange, TodoItem, TodoListener } from "./types";
import { TodoRepository } from "./repository";

/**
 * Pure data layer for the TODO list.
 * Reads/Writes a markdown file with checkbox items via the injected
 * `TodoRepository`. Uses the observer pattern (same as TerminalRegistry).
 */
export class TodoStore {
    private items: TodoItem[] = [];
    private listeners = new Set<TodoListener>();
    private repository: TodoRepository;

    constructor(workspaceRoot: string, repository?: TodoRepository) {
        // Allow tests to inject a mock repository in the future; the
        // default builds a real one bound to the workspace root.
        this.repository = repository ?? new TodoRepository(workspaceRoot);
    }

    getItems(): TodoItem[] {
        return this.items;
    }

    getCompletedCount(): number {
        let count = 0;
        const traverse = (items: TodoItem[]): void => {
            for (const item of items) {
                if (item.checked) count++;
                if (item.children) traverse(item.children);
            }
        };
        traverse(this.items);
        return count;
    }

    async reset(): Promise<void> {
        await this.load();
    }

    async load(): Promise<void> {
        const result = await this.repository.read();
        if (result.items === null) {
            // File missing — emit an empty snapshot so listeners can
            // re-render into a blank state.
            this.items = [];
            this.emit({ type: "loaded", items: [] });
            return;
        }
        this.items = result.items;
        this.emit({ type: "loaded", items: result.items });
    }

    async toggle(item: TodoItem): Promise<void> {
        const fresh = await this.repository.read();
        if (fresh.items === null) return;
        const content = fresh.content;
        const lines = content.split("\n");
        if (item.line >= lines.length) return;

        const re = /^(\s*[-*+]\s+)\[(\s|x|X)\](\s+.*)$/;
        const m = lines[item.line]!.match(re);
        if (!m) return;

        const isDone = m[2]!.toLowerCase() === "x";
        const newMarker = isDone ? " " : "x";
        lines[item.line] = `${m[1]}[${newMarker}]${m[3]}`;

        await this.repository.write(lines.join("\n"));

        item.checked = !item.checked;
        this.emit({ type: "toggled", item });
    }

    async updatePriority(item: TodoItem, newPriority: "P0" | "P1" | "P2" | "None"): Promise<void> {
        const result = await this.repository.read();
        if (result.items === null) return;
        const lines = result.content.split("\n");
        if (item.line >= lines.length) return;

        // Path 1: line already has a priority tag — replace or remove it.
        const replaceRe = /^(\s*[-*+]\s+(?:\[[^\]]*\]\s+)?)(?:\[|\()P[0-2](?:\]|\))(\s+.*)$/;
        const m = lines[item.line]!.match(replaceRe);
        if (m) {
            if (newPriority === "None") {
                lines[item.line] = `${m[1]}${m[2]!.trimStart()}`;
            } else {
                lines[item.line] = `${m[1]}[${newPriority}]${m[2]}`;
            }
        } else {
            if (newPriority !== "None") {
                // Path 2: no priority prefix — insert `[Px] ` after the
                // optional checkbox marker.
                const insertRe = /^(\s*[-*+]\s+(?:\[[^\]]*\]\s+)?)(\S.*)$/;
                const im = lines[item.line]!.match(insertRe);
                if (!im) return;
                lines[item.line] = `${im[1]}[${newPriority}] ${im[2]}`;
            }
        }
        await this.repository.write(lines.join("\n"));

        // Reload so the in-memory `items` reflect the new prefix. The file
        // is the source of truth; we don't mutate `item.text` (it's readonly).
        // Emitting "loaded" makes TodoTreeProvider re-render with fresh data.
        await this.load();
    }

    async addTodo(text: string, sectionName: string): Promise<void> {
        const fresh = await this.repository.read();
        // Missing file falls back to the same `# TODO` seed the
        // original code used; an empty string also seeds the file
        // because `applyAddTodo` always opens with that header.
        const seed = fresh.content || "# TODO\n";
        await this.applyAddTodo(seed, text, sectionName);
        await this.load();
    }

    private async applyAddTodo(
        content: string,
        text: string,
        sectionName: string
    ): Promise<void> {
        const lines = content.split("\n");
        const isDefaultSection = sectionName.toLowerCase() === "default";

        if (isDefaultSection) {
            // Find `# TODO` or first heading
            let targetLineIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i]!.trim().startsWith("# ")) {
                    targetLineIndex = i;
                    break;
                }
            }

            if (targetLineIndex === -1) {
                // Section does not exist. Append to the end.
                if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
                    lines.push("");
                }
                lines.push(`- [ ] ${text}`);
            } else {
                // Section exists. Find the head of the section (first list item or next heading).
                let insertIndex = -1;
                for (let i = targetLineIndex + 1; i < lines.length; i++) {
                    const line = lines[i]!.trim();
                    if (line.startsWith("##") || line.startsWith("###")) {
                        // We hit the next section. Insert before it.
                        let j = i;
                        while (j > targetLineIndex + 1 && lines[j - 1]!.trim() === "") {
                            j--;
                        }
                        insertIndex = j;
                        break;
                    }
                    if (line.match(/^[-*+]\s+/)) {
                        insertIndex = i;
                        break;
                    }
                }
                if (insertIndex === -1) {
                    // No other sections and no list items, so just insert after targetLineIndex + 1
                    let j = targetLineIndex + 1;
                    while (j < lines.length && lines[j]!.trim() === "") {
                        j++;
                    }
                    insertIndex = j;
                }

                if (insertIndex === targetLineIndex + 1) {
                    // Empty section: insert a blank line, then the item.
                    lines.splice(targetLineIndex + 1, 0, "", `- [ ] ${text}`);
                } else {
                    lines.splice(insertIndex, 0, `- [ ] ${text}`);
                }
            }
        } else {
            // Find `## sectionName` or `### sectionName`
            let targetLineIndex = -1;
            const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const sectionRe = new RegExp(`^(##+)\\s+${escapedName}\\b`, "i");
            for (let i = 0; i < lines.length; i++) {
                if (lines[i]!.match(sectionRe)) {
                    targetLineIndex = i;
                    break;
                }
            }

            if (targetLineIndex === -1) {
                // Section does not exist. Append to the end.
                if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
                    lines.push("");
                }
                lines.push(`## ${sectionName}`);
                lines.push(`- [ ] ${text}`);
            } else {
                // Section exists. Find the end of the section.
                let insertIndex = lines.length;
                for (let i = targetLineIndex + 1; i < lines.length; i++) {
                    if (lines[i]!.trim().startsWith("##") || lines[i]!.trim().startsWith("###")) {
                        insertIndex = i;
                        break;
                    }
                }

                // Find the last non-empty line before insertIndex.
                let lastNonEmpty = insertIndex - 1;
                while (lastNonEmpty > targetLineIndex && lines[lastNonEmpty]!.trim() === "") {
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
        }

        await this.repository.write(lines.join("\n"));
    }

    async moveTodo(item: TodoItem, sectionName: string): Promise<void> {
        const fresh = await this.repository.read();
        if (fresh.items === null) return;
        const content = fresh.content;
        const lines = content.split("\n");
        if (item.line >= lines.length) return;

        // 1. Find the block of lines to move (the item and its children based on indentation)
        const parentIndentMatch = lines[item.line]!.match(/^\s*/);
        const parentIndent = parentIndentMatch ? parentIndentMatch[0].length : 0;

        let lastChildLineIndex = item.line;
        for (let i = item.line + 1; i < lines.length; i++) {
            const line = lines[i]!;
            if (line.trim() === "") {
                continue;
            }
            const currentIndentMatch = line.match(/^\s*/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[0].length : 0;
            if (currentIndent > parentIndent) {
                lastChildLineIndex = i;
            } else {
                break;
            }
        }

        const numLinesToMove = lastChildLineIndex - item.line + 1;
        const blockLines = lines.splice(item.line, numLinesToMove);

        // Adjust indentation of the moved block so the main item starts at 0 indent
        const adjustedBlockLines = blockLines.map((line) => {
            if (line.trim() === "") return line;
            const currentIndentMatch = line.match(/^\s*/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[0].length : 0;
            const newIndent = Math.max(0, currentIndent - parentIndent);
            return " ".repeat(newIndent) + line.substring(currentIndent);
        });

        // 2. Find or create the target section
        const isDefaultSection = sectionName.toLowerCase() === "default";

        if (isDefaultSection) {
            // Find `# TODO` or first heading
            let targetLineIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i]!.trim().startsWith("# ")) {
                    targetLineIndex = i;
                    break;
                }
            }

            if (targetLineIndex === -1) {
                // Section does not exist. Append to the end.
                if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
                    lines.push("");
                }
                lines.push(...adjustedBlockLines);
            } else {
                // Section exists. Find the head of the section (first list item or next heading).
                let insertIndex = -1;
                for (let i = targetLineIndex + 1; i < lines.length; i++) {
                    const line = lines[i]!.trim();
                    if (line.startsWith("##") || line.startsWith("###")) {
                        // We hit the next section. Insert before it.
                        let j = i;
                        while (j > targetLineIndex + 1 && lines[j - 1]!.trim() === "") {
                            j--;
                        }
                        insertIndex = j;
                        break;
                    }
                    if (line.match(/^[-*+]\s+/)) {
                        insertIndex = i;
                        break;
                    }
                }
                if (insertIndex === -1) {
                    // No other sections and no list items, so just insert after targetLineIndex + 1
                    let j = targetLineIndex + 1;
                    while (j < lines.length && lines[j]!.trim() === "") {
                        j++;
                    }
                    insertIndex = j;
                }

                if (insertIndex === targetLineIndex + 1) {
                    // Empty section: insert a blank line first.
                    lines.splice(targetLineIndex + 1, 0, "", ...adjustedBlockLines);
                } else {
                    lines.splice(insertIndex, 0, ...adjustedBlockLines);
                }
            }
        } else {
            // Find `## sectionName` or `### sectionName`
            let targetLineIndex = -1;
            const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const sectionRe = new RegExp(`^(##+)\\s+${escapedName}\\b`, "i");
            for (let i = 0; i < lines.length; i++) {
                if (lines[i]!.match(sectionRe)) {
                    targetLineIndex = i;
                    break;
                }
            }

            if (targetLineIndex === -1) {
                // Section does not exist. Append to the end.
                if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
                    lines.push("");
                }
                lines.push(`## ${sectionName}`);
                lines.push(...adjustedBlockLines);
            } else {
                const isArchive = sectionName.toLowerCase() === "archive";
                if (isArchive) {
                    // Find the head of the Archive section.
                    let insertIndex = -1;
                    for (let i = targetLineIndex + 1; i < lines.length; i++) {
                        const line = lines[i]!.trim();
                        if (line.startsWith("##") || line.startsWith("###")) {
                            // Hit another section heading.
                            let j = i;
                            while (j > targetLineIndex + 1 && lines[j - 1]!.trim() === "") {
                                j--;
                            }
                            insertIndex = j;
                            break;
                        }
                        if (line.match(/^[-*+]\s+/)) {
                            insertIndex = i;
                            break;
                        }
                    }
                    if (insertIndex === -1) {
                        let j = targetLineIndex + 1;
                        while (j < lines.length && lines[j]!.trim() === "") {
                            j++;
                        }
                        insertIndex = j;
                    }

                    if (insertIndex === targetLineIndex + 1) {
                        lines.splice(targetLineIndex + 1, 0, "", ...adjustedBlockLines);
                    } else {
                        lines.splice(insertIndex, 0, ...adjustedBlockLines);
                    }
                } else {
                    // Find the end of the section (for general sections).
                    let insertIndex = lines.length;
                    for (let i = targetLineIndex + 1; i < lines.length; i++) {
                        if (lines[i]!.trim().startsWith("##") || lines[i]!.trim().startsWith("###")) {
                            insertIndex = i;
                            break;
                        }
                    }

                    // Find the last non-empty line before insertIndex.
                    let lastNonEmpty = insertIndex - 1;
                    while (lastNonEmpty > targetLineIndex && lines[lastNonEmpty]!.trim() === "") {
                        lastNonEmpty--;
                    }

                    if (lastNonEmpty === targetLineIndex) {
                        // Empty section: insert a blank line first.
                        const numBlankLines = insertIndex - (targetLineIndex + 1);
                        lines.splice(targetLineIndex + 1, numBlankLines, "", ...adjustedBlockLines);
                    } else {
                        // Has items: insert directly after the last item.
                        const numBlankLines = insertIndex - (lastNonEmpty + 1);
                        lines.splice(lastNonEmpty + 1, numBlankLines, ...adjustedBlockLines);
                    }

                    // If there's another section following, ensure a single blank line separating them
                    const newInsertIndex = lastNonEmpty === targetLineIndex
                        ? targetLineIndex + 1 + 1 + adjustedBlockLines.length
                        : lastNonEmpty + 1 + adjustedBlockLines.length;
                    if (newInsertIndex < lines.length && lines[newInsertIndex]!.trim() !== "") {
                        lines.splice(newInsertIndex, 0, "");
                    }
                }
            }
        }

        await this.repository.write(lines.join("\n"));
        await this.load();
    }

    async archiveTodo(item: TodoItem): Promise<void> {
        await this.moveTodo(item, "Archive");
    }

    async deleteSection(item: TodoItem): Promise<void> {
        const fresh = await this.repository.read();
        if (fresh.items === null) return;
        const content = fresh.content;
        const lines = content.split("\n");
        let startLine = -1;
        let endLine = -1;

        if (item.line >= 0) {
            // General section with header line
            startLine = item.line;
            endLine = lines.length;
            for (let i = startLine + 1; i < lines.length; i++) {
                if (lines[i]!.trim().startsWith("#")) {
                    endLine = i;
                    break;
                }
            }
        } else if (item.text === "Default") {
            // Default section (line === -1)
            startLine = 0;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i]!.trim().startsWith("# ")) {
                    startLine = i + 1;
                    break;
                }
            }
            endLine = lines.length;
            for (let i = startLine; i < lines.length; i++) {
                if (lines[i]!.trim().match(/^(##+)\s+(.*)$/)) {
                    endLine = i;
                    break;
                }
            }
        }

        if (startLine >= 0 && endLine >= startLine) {
            lines.splice(startLine, endLine - startLine);

            // Check if we need to insert a blank line between two adjacent headings
            if (startLine > 0 && startLine < lines.length) {
                const prevLine = lines[startLine - 1]!.trim();
                const currLine = lines[startLine]!.trim();
                if (prevLine.startsWith("#") && currLine.startsWith("#")) {
                    lines.splice(startLine, 0, "");
                }
            }

            await this.repository.write(lines.join("\n"));
            await this.load();
        }
    }

    async updateText(line: number, newText: string): Promise<void> {
        const fresh = await this.repository.read();
        if (fresh.items === null) return;
        const content = fresh.content;
        const lines = content.split("\n");
        if (line < 0 || line >= lines.length) return;

        const re = /^(\s*[-*+]\s+(?:\[[\s|x|X]\]\s+)?)(.*)$/;
        const m = lines[line]!.match(re);
        if (m) {
            lines[line] = `${m[1]}${newText}`;
        } else {
            return;
        }

        await this.repository.write(lines.join("\n"));
        await this.load();
    }

    async deleteTodo(item: TodoItem): Promise<void> {
        const fresh = await this.repository.read();
        if (fresh.items === null) return;
        const content = fresh.content;
        const lines = content.split("\n");
        if (item.line >= lines.length) return;

        const parentIndentMatch = lines[item.line]!.match(/^\s*/);
        const parentIndent = parentIndentMatch ? parentIndentMatch[0].length : 0;

        let lastChildLineIndex = item.line;
        for (let i = item.line + 1; i < lines.length; i++) {
            const line = lines[i]!;
            if (line.trim() === "") {
                continue;
            }
            const currentIndentMatch = line.match(/^\s*/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[0].length : 0;
            if (currentIndent > parentIndent) {
                lastChildLineIndex = i;
            } else {
                break;
            }
        }

        const numLinesToDelete = lastChildLineIndex - item.line + 1;
        lines.splice(item.line, numLinesToDelete);

        await this.repository.write(lines.join("\n"));
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
