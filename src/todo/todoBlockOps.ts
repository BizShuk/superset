// Block operations for TODO markdown manipulation — pure helpers used by
// `todoStore.ts` business methods. No state, no I/O, no `vscode` dependency.
// Separated from the store class as Stage A of the code-quality pass; the
// class methods (toggle / archiveSection / moveTodo / etc.) are still in
// `todoStore.ts` and call into these via plain function imports.

import { TAGS_RE, constructTags } from "./parser";
import type { TodoChange } from "./types";
import type { TodoRepository } from "./repository";

/**
 * The minimal surface area of `TodoStore` that the extracted ops
 * functions (`todoMutations`, `todoSectionOps`, `todoMoveOps`) need
 * to do their work. Defining it here lets the ops modules take
 * `TodoStoreContext` instead of importing the full `TodoStore` class
 * — keeps dependencies one-directional and lets tests mock the
 * context without subclassing the store.
 */
export interface TodoStoreContext {
    readonly repository: TodoRepository;
    writeAndLoad(lines: string[]): Promise<void>;
    emit(change: TodoChange): void;
}

/**
 * Return the line index that ends the heading block rooted at `startLine`,
 * where `startLine` is itself a heading. The block ends at the line BEFORE
 * `i` if `i` matches the regex.
 *
 * Inclusive of `startLine`, exclusive of the returned index — the returned
 * index is the first subsequent `##+` heading whose depth is <= `level`, or EOF.
 * Mirrors `HEADING_RE` in `parser.ts`.
 */
export function findSectionBlockEnd(
    lines: string[],
    startLine: number,
    level: number
): number {
    for (let i = startLine + 1; i < lines.length; i++) {
        const hm = lines[i]!.match(/^(#{2,})\s+/);
        if (hm && hm[1]!.length <= level) return i;
    }
    return lines.length;
}

/** Index of the top-level `## Archive` heading, or -1 if it doesn't exist. */
export function findArchiveHeadingIndex(lines: string[]): number {
    const re = /^##(?!#)\s+archive\s*$/i;
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!.trim())) return i;
    }
    return -1;
}

/** Drop trailing blank lines from an extracted block (keeps the heading line). */
export function stripTrailingBlank(block: string[]): string[] {
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
export function fixAdjacentHeadings(lines: string[], at: number): void {
    if (at > 0 && at < lines.length) {
        const prev = lines[at - 1]!.trim();
        const curr = lines[at]!.trim();
        if (prev.startsWith("#") && curr.startsWith("#")) {
            lines.splice(at, 0, "");
        }
    }
}

/** Find the original section name of a line by scanning backwards to the nearest heading. */
export function findSectionNameOfLine(
    lines: string[],
    lineIndex: number
): string {
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
export function getFormattedDateTime(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day}_${hours}:${minutes}:${seconds}`;
}

/** Ensure the ## Archive section (and its contents) is the last section of the document. */
export function ensureArchiveIsLastSection(lines: string[]): string[] {
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
export function applyArchiveOrComplete(
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
        const currentIndent = currentIndentMatch
            ? currentIndentMatch[0].length
            : 0;
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
        const currentIndent = currentIndentMatch
            ? currentIndentMatch[0].length
            : 0;
        const newIndent = Math.max(0, currentIndent - parentIndent);
        return " ".repeat(newIndent) + l.substring(currentIndent);
    });

    let mainLine = adjustedBlockLines[0]!;
    mainLine = mainLine.replace(TAGS_RE, "");

    const marker = isCompleted ? "x" : " ";
    mainLine = mainLine.replace(
        /^(\s*[-*+]\s+)\[(\s|x|X)\]/,
        `$1[${marker}]`
    );

    const state = isCompleted ? "Completed" : "Archived";
    const tags = constructTags(dateStr, state, originalSection);
    adjustedBlockLines[0] = mainLine + tags;

    return { blockLines: adjustedBlockLines, originalSection };
}

/** Insert a block of lines at the head of ## Archive section (creating ## Archive if missing). */
export function insertBlockIntoArchive(
    lines: string[],
    blockLines: string[]
): void {
    const archiveIndex = findArchiveHeadingIndex(lines);
    if (archiveIndex === -1) {
        if (
            lines.length > 0 &&
            lines[lines.length - 1]!.trim() !== ""
        ) {
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