// TodoStore — pure in-memory state holder. Owns the parsed `TodoItem[]`
// snapshot and an observer-pattern listener set. All filesystem I/O
// flows through `TodoRepository`; the parsing algorithm lives in
// `./parser`. The store's public surface is unchanged from before
// the refactor — see the existing 23-case test suite for the contract.

import type { TodoChange, TodoItem, TodoListener } from "./types";
import { TodoRepository } from "./repository";
import { isArchivedTask, parseTagsFromLine, constructTags, TAGS_RE } from "./parser";

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
        const isArchived = isArchivedTask(lines[item.line]!) || item.parentSection?.toLowerCase() === "archive";

        if (isArchived) {
            const newMarker = isDone ? " " : "x";
            let mainLine = lines[item.line]!;
            mainLine = mainLine.replace(/^(\s*[-*+]\s+)\[(\s|x|X)\]/, `$1[${newMarker}]`);
            
            const parsed = parseTagsFromLine(mainLine);
            if (parsed) {
                const newState = isDone ? "Archived" : "Completed";
                const dateStr = getFormattedDateTime();
                mainLine = mainLine.replace(TAGS_RE, "");
                const tags = constructTags(dateStr, newState, parsed.sectionName || "Default");
                mainLine = mainLine + tags;
            }
            lines[item.line] = mainLine;
            await this.writeAndLoad(lines);
        } else {
            const parentIndentMatch = lines[item.line]!.match(/^\s*/);
            const parentIndent = parentIndentMatch ? parentIndentMatch[0].length : 0;

            if (!isDone) {
                if (parentIndent === 0) {
                    const dateStr = getFormattedDateTime();
                    const { blockLines } = applyArchiveOrComplete(lines, item.line, true, dateStr);
                    insertBlockIntoArchive(lines, blockLines);
                    await this.writeAndLoad(lines);
                } else {
                    const newMarker = "x";
                    lines[item.line] = `${m[1]}[${newMarker}]${m[3]}`;
                    const cleanedLines = ensureArchiveIsLastSection(lines);
                    await this.repository.write(cleanedLines.join("\n"));
                    item.checked = !item.checked;
                    this.emit({ type: "toggled", item });
                }
            } else {
                const newMarker = " ";
                lines[item.line] = `${m[1]}[${newMarker}]${m[3]}`;
                const cleanedLines = ensureArchiveIsLastSection(lines);
                await this.repository.write(cleanedLines.join("\n"));
                item.checked = !item.checked;
                this.emit({ type: "toggled", item });
            }
        }
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
        await this.writeAndLoad(lines);
    }

    async addTodo(text: string, sectionName: string): Promise<void> {
        const fresh = await this.repository.read();
        // Missing file falls back to the same `# TODO` seed the
        // original code used; an empty string also seeds the file
        // because `applyAddTodo` always opens with that header.
        const seed = fresh.content || "# TODO\n";
        await this.applyAddTodo(seed, text, sectionName);
    }

    private async applyAddTodo(
        content: string,
        text: string,
        sectionName: string
    ): Promise<void> {
        const lines = content.split("\n");
        const isDefaultSection = sectionName.toLowerCase() === "default" || sectionName.toLowerCase() === "todo";

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

        await this.writeAndLoad(lines);
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
        const isDefaultSection = sectionName.toLowerCase() === "default" || sectionName.toLowerCase() === "todo";

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

        await this.writeAndLoad(lines);
    }

    async archiveTodo(item: TodoItem): Promise<void> {
        const fresh = await this.repository.read();
        if (fresh.items === null) return;
        const lines = fresh.content.split("\n");
        if (item.line >= lines.length) return;

        const dateStr = getFormattedDateTime();
        const re = /^(\s*[-*+]\s+)\[(\s|x|X)\]/;
        const m = lines[item.line]!.match(re);
        const isCompleted = m ? m[2]!.toLowerCase() === "x" : false;

        const { blockLines } = applyArchiveOrComplete(lines, item.line, isCompleted, dateStr);
        insertBlockIntoArchive(lines, blockLines);

        await this.writeAndLoad(lines);
    }

    async rollbackTodo(item: TodoItem): Promise<void> {
        const fresh = await this.repository.read();
        if (fresh.items === null) return;
        const lines = fresh.content.split("\n");
        if (item.line >= lines.length) return;

        const line = lines[item.line]!;
        const parsed = parseTagsFromLine(line);
        const targetSection = parsed?.sectionName || "Default";

        let mainLine = line.replace(TAGS_RE, "");
        lines[item.line] = mainLine;

        const parentIndentMatch = mainLine.match(/^\s*/);
        const parentIndent = parentIndentMatch ? parentIndentMatch[0].length : 0;

        let lastChildLineIndex = item.line;
        for (let i = item.line + 1; i < lines.length; i++) {
            const l = lines[i]!;
            if (l.trim() === "") continue;
            const currentIndentMatch = l.match(/^\s*/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[0].length : 0;
            if (currentIndent > parentIndent) {
                lastChildLineIndex = i;
            } else {
                break;
            }
        }

        const numLinesToMove = lastChildLineIndex - item.line + 1;
        const blockLines = lines.splice(item.line, numLinesToMove);

        const adjustedBlockLines = blockLines.map((l) => {
            if (l.trim() === "") return l;
            const currentIndentMatch = l.match(/^\s*/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[0].length : 0;
            const newIndent = Math.max(0, currentIndent - parentIndent);
            return " ".repeat(newIndent) + l.substring(currentIndent);
        });

        const isDefaultSection = targetSection.toLowerCase() === "default" || targetSection.toLowerCase() === "todo";

        if (isDefaultSection) {
            let targetLineIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i]!.trim().startsWith("# ")) {
                    targetLineIndex = i;
                    break;
                }
            }

            if (targetLineIndex === -1) {
                if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
                    lines.push("");
                }
                lines.push(...adjustedBlockLines);
            } else {
                let insertIndex = -1;
                for (let i = targetLineIndex + 1; i < lines.length; i++) {
                    const l = lines[i]!.trim();
                    if (l.startsWith("##") || l.startsWith("###")) {
                        let j = i;
                        while (j > targetLineIndex + 1 && lines[j - 1]!.trim() === "") {
                            j--;
                        }
                        insertIndex = j;
                        break;
                    }
                    if (l.match(/^[-*+]\s+/)) {
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
            }
        } else {
            let targetLineIndex = -1;
            const escapedName = targetSection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const sectionRe = new RegExp(`^(##+)\\s+${escapedName}\\b`, "i");
            for (let i = 0; i < lines.length; i++) {
                if (lines[i]!.match(sectionRe)) {
                    targetLineIndex = i;
                    break;
                }
            }

            if (targetLineIndex === -1) {
                const archiveIndex = findArchiveHeadingIndex(lines);
                if (archiveIndex !== -1) {
                    lines.splice(archiveIndex, 0, `## ${targetSection}`, ...adjustedBlockLines, "");
                } else {
                    if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
                        lines.push("");
                    }
                    lines.push(`## ${targetSection}`);
                    lines.push(...adjustedBlockLines);
                }
            } else {
                let insertIndex = lines.length;
                for (let i = targetLineIndex + 1; i < lines.length; i++) {
                    if (lines[i]!.trim().startsWith("##") || lines[i]!.trim().startsWith("###")) {
                        insertIndex = i;
                        break;
                    }
                }

                let lastNonEmpty = insertIndex - 1;
                while (lastNonEmpty > targetLineIndex && lines[lastNonEmpty]!.trim() === "") {
                    lastNonEmpty--;
                }

                if (lastNonEmpty === targetLineIndex) {
                    const numBlankLines = insertIndex - (targetLineIndex + 1);
                    lines.splice(targetLineIndex + 1, numBlankLines, "", ...adjustedBlockLines);
                } else {
                    const numBlankLines = insertIndex - (lastNonEmpty + 1);
                    lines.splice(lastNonEmpty + 1, numBlankLines, ...adjustedBlockLines);
                }

                const newInsertIndex = lastNonEmpty === targetLineIndex
                    ? targetLineIndex + 1 + 1 + adjustedBlockLines.length
                    : lastNonEmpty + 1 + adjustedBlockLines.length;
                if (newInsertIndex < lines.length && lines[newInsertIndex]!.trim() !== "") {
                    lines.splice(newInsertIndex, 0, "");
                }
            }
        }

        await this.writeAndLoad(lines);
    }

    /**
     * Move an entire top-level section (its heading line + everything
     * up to the next heading of the same-or-shallower level) under the
     * `## Archive` section, demoting its own heading to `###` so it
     * nests visually under Archive. Creates `## Archive` if it doesn't
     * exist yet. No-op for the synthetic Default section / priority-
     * file view groups (`item.level === undefined`).
     *
     * Always appended at the *end* of Archive's existing content, never
     * right after the `## Archive` heading. Markdown has no explicit
     * closing marker for a heading's section — content only ends at the
     * next heading. Inserting at the head would put the new `###` block
     * directly above Archive's pre-existing flat (headless) items, which
     * would then read as nested *under* that `###` heading instead of
     * as Archive's own direct content.
     */
    async archiveSection(item: TodoItem): Promise<void> {
        if (item.line < 0 || item.level === undefined) return;
        const fresh = await this.repository.read();
        if (fresh.items === null) return;
        const lines = fresh.content.split("\n");
        if (item.line >= lines.length) return;

        const endLine = findSectionBlockEnd(lines, item.line, item.level);
        const rawBlock = lines.slice(item.line, endLine);
        lines.splice(item.line, endLine - item.line);
        fixAdjacentHeadings(lines, item.line);

        const blockLines = stripTrailingBlank(rawBlock);
        blockLines[0] = blockLines[0]!.replace(/^#+/, "###");

        const archiveIndex = findArchiveHeadingIndex(lines);
        if (archiveIndex === -1) {
            if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
                lines.push("");
            }
            lines.push("## Archive", "", ...blockLines);
        } else {
            const sectionEnd = findSectionBlockEnd(lines, archiveIndex, 2);
            let lastNonBlank = sectionEnd - 1;
            while (lastNonBlank > archiveIndex && lines[lastNonBlank]!.trim() === "") {
                lastNonBlank--;
            }
            const insertAt = lastNonBlank === archiveIndex ? archiveIndex + 1 : lastNonBlank + 1;
            lines.splice(insertAt, sectionEnd - insertAt, "", ...blockLines);

            // If Archive isn't the last section, keep a single blank line
            // separating our appended block from whatever heading follows.
            const afterBlock = insertAt + 1 + blockLines.length;
            if (afterBlock < lines.length && lines[afterBlock]!.trim() !== "") {
                lines.splice(afterBlock, 0, "");
            }
        }

        await this.writeAndLoad(lines);
    }

    /**
     * Reverse of `archiveSection`: move a `###` subsection nested under
     * `## Archive` back out to the top level, promoting its heading to
     * `##`. Inserted right before the `## Archive` heading so Archive
     * stays the last section. No-op unless `item.level === 3`.
     */
    async unarchiveSection(item: TodoItem): Promise<void> {
        if (item.line < 0 || item.level !== 3) return;
        const fresh = await this.repository.read();
        if (fresh.items === null) return;
        const lines = fresh.content.split("\n");
        if (item.line >= lines.length) return;

        const endLine = findSectionBlockEnd(lines, item.line, item.level);
        const rawBlock = lines.slice(item.line, endLine);
        lines.splice(item.line, endLine - item.line);
        fixAdjacentHeadings(lines, item.line);

        const blockLines = stripTrailingBlank(rawBlock);
        blockLines[0] = blockLines[0]!.replace(/^#+/, "##");

        const archiveIndex = findArchiveHeadingIndex(lines);
        if (archiveIndex === -1) {
            if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
                lines.push("");
            }
            lines.push(...blockLines);
        } else {
            lines.splice(archiveIndex, 0, ...blockLines, "");
        }

        await this.writeAndLoad(lines);
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

            await this.writeAndLoad(lines);
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

        await this.writeAndLoad(lines);
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

        await this.writeAndLoad(lines);
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

    private async writeAndLoad(lines: string[]): Promise<void> {
        const cleanedLines = ensureArchiveIsLastSection(lines);
        await this.repository.write(cleanedLines.join("\n"));
        await this.load();
    }
}

/**
 * Find the end (exclusive) of a section block starting at `startLine`:
 * the first subsequent `##+` heading whose depth is <= `level`, or EOF.
 * Mirrors `HEADING_RE` in `parser.ts`.
 */
function findSectionBlockEnd(lines: string[], startLine: number, level: number): number {
    for (let i = startLine + 1; i < lines.length; i++) {
        const hm = lines[i]!.match(/^(#{2,})\s+/);
        if (hm && hm[1]!.length <= level) return i;
    }
    return lines.length;
}

/** Index of the top-level `## Archive` heading, or -1 if it doesn't exist. */
function findArchiveHeadingIndex(lines: string[]): number {
    const re = /^##(?!#)\s+archive\s*$/i;
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!.trim())) return i;
    }
    return -1;
}

/** Drop trailing blank lines from an extracted block (keeps the heading line). */
function stripTrailingBlank(block: string[]): string[] {
    const copy = [...block];
    while (copy.length > 1 && copy[copy.length - 1]!.trim() === "") {
        copy.pop();
    }
    return copy;
}

/**
 * After splicing a block out at `at`, insert a blank line if that left
 * two heading lines directly adjacent (mirrors `deleteSection`'s fixup).
 */
function fixAdjacentHeadings(lines: string[], at: number): void {
    if (at > 0 && at < lines.length) {
        const prev = lines[at - 1]!.trim();
        const curr = lines[at]!.trim();
        if (prev.startsWith("#") && curr.startsWith("#")) {
            lines.splice(at, 0, "");
        }
    }
}

/** Find the original section name of a line by scanning backwards to the nearest heading. */
function findSectionNameOfLine(lines: string[], lineIndex: number): string {
    for (let i = lineIndex - 1; i >= 0; i--) {
        const m = lines[i]!.match(/^(##+)\s+(.*)$/);
        if (m) {
            const sectionName = m[2]!.trim();
            if (sectionName.toLowerCase() === "archive") {
                return "Default";
            }
            return sectionName;
        }
    }
    return "Default";
}

/** Get current date time formatted as YYYY-MM-DD_HH:mm:ss. */
function getFormattedDateTime(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}:${minutes}:${seconds}`;
}

/** Ensure the ## Archive section (and its contents) is the last section of the document. */
function ensureArchiveIsLastSection(lines: string[]): string[] {
    const archiveIndex = findArchiveHeadingIndex(lines);
    if (archiveIndex === -1) return lines;

    const endLine = findSectionBlockEnd(lines, archiveIndex, 2);
    const archiveBlock = lines.slice(archiveIndex, endLine);
    
    lines.splice(archiveIndex, endLine - archiveIndex);
    fixAdjacentHeadings(lines, archiveIndex);

    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
        lines.pop();
    }

    if (lines.length > 0) {
        lines.push("");
    }
    lines.push(...archiveBlock);
    return lines;
}

/** Extract and format a task (with children) for archiving or completing. */
function applyArchiveOrComplete(
    lines: string[],
    lineIndex: number,
    isCompleted: boolean,
    dateStr: string
): { blockLines: string[]; originalSection: string } {
    const line = lines[lineIndex]!;
    const originalSection = findSectionNameOfLine(lines, lineIndex);

    const parentIndentMatch = line.match(/^\s*/);
    const parentIndent = parentIndentMatch ? parentIndentMatch[0].length : 0;

    let lastChildLineIndex = lineIndex;
    for (let i = lineIndex + 1; i < lines.length; i++) {
        const l = lines[i]!;
        if (l.trim() === "") continue;
        const currentIndentMatch = l.match(/^\s*/);
        const currentIndent = currentIndentMatch ? currentIndentMatch[0].length : 0;
        if (currentIndent > parentIndent) {
            lastChildLineIndex = i;
        } else {
            break;
        }
    }

    const numLinesToMove = lastChildLineIndex - lineIndex + 1;
    const blockLines = lines.splice(lineIndex, numLinesToMove);

    const adjustedBlockLines = blockLines.map((l) => {
        if (l.trim() === "") return l;
        const currentIndentMatch = l.match(/^\s*/);
        const currentIndent = currentIndentMatch ? currentIndentMatch[0].length : 0;
        const newIndent = Math.max(0, currentIndent - parentIndent);
        return " ".repeat(newIndent) + l.substring(currentIndent);
    });

    let mainLine = adjustedBlockLines[0]!;
    mainLine = mainLine.replace(TAGS_RE, "");

    const marker = isCompleted ? "x" : " ";
    mainLine = mainLine.replace(/^(\s*[-*+]\s+)\[(\s|x|X)\]/, `$1[${marker}]`);

    const state = isCompleted ? "Completed" : "Archived";
    const tags = constructTags(dateStr, state, originalSection);
    adjustedBlockLines[0] = mainLine + tags;

    return { blockLines: adjustedBlockLines, originalSection };
}

/** Insert a block of lines at the head of ## Archive section (creating ## Archive if missing). */
function insertBlockIntoArchive(lines: string[], blockLines: string[]): void {
    const archiveIndex = findArchiveHeadingIndex(lines);
    if (archiveIndex === -1) {
        if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") {
            lines.push("");
        }
        lines.push("## Archive", "", ...blockLines);
    } else {
        let insertIndex = -1;
        for (let i = archiveIndex + 1; i < lines.length; i++) {
            const line = lines[i]!.trim();
            if (line.startsWith("##") || line.startsWith("###")) {
                let j = i;
                while (j > archiveIndex + 1 && lines[j - 1]!.trim() === "") {
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
            let j = archiveIndex + 1;
            while (j < lines.length && lines[j]!.trim() === "") {
                j++;
            }
            insertIndex = j;
        }

        if (insertIndex === archiveIndex + 1) {
            lines.splice(archiveIndex + 1, 0, "", ...blockLines);
        } else {
            lines.splice(insertIndex, 0, ...blockLines);
        }
    }
}
