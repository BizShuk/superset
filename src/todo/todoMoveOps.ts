// Block-movement operations — moving a todo item (plus its
// indented children) to another section, adding a new item, and
// archiving / rolling-back the whole block at once. Distinct from
// `todoMutations` (single-line tweaks) and `todoSectionOps` (whole
// sections). Extracted from `TodoStore` as Plan 2 Stage A's
// `todoMoveOps.ts` slot.

import type { TodoItem } from "./types";
import {
    applyArchiveOrComplete,
    getFormattedDateTime,
    insertBlockIntoArchive,
    type TodoStoreContext,
} from "./todoBlockOps";
import { parseTagsFromLine, TAGS_RE } from "./parser";

/**
 * Find the block of lines belonging to `item` (the item itself plus
 * any indented children) and splice it out of the source position,
 * adjusting the children's indentation so the whole block has the
 * same shape as if it were authored at the top level. Returns
 * `{ blockLines, sourceRemoved }` where `sourceRemoved === true` if
 * the splice actually took some lines out of the source.
 *
 * Used by `moveTodo` and `rollbackTodo` — both perform an
 * extract-and-reinsert dance across sections.
 */
function extractBlock(
    lines: string[],
    item: TodoItem
): { blockLines: string[]; removedCount: number } {
    const parentIndentMatch = lines[item.line]!.match(/^\s*/);
    const parentIndent = parentIndentMatch
        ? parentIndentMatch[0].length
        : 0;

    let lastChildLineIndex = item.line;
    for (let i = item.line + 1; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.trim() === "") continue;
        const currentIndentMatch = line.match(/^\s*/);
        const currentIndent = currentIndentMatch
            ? currentIndentMatch[0].length
            : 0;
        if (currentIndent > parentIndent) {
            lastChildLineIndex = i;
        } else {
            break;
        }
    }

    const numLinesToMove = lastChildLineIndex - item.line + 1;
    const blockLines = lines.splice(item.line, numLinesToMove);

    const adjusted = blockLines.map((line) => {
        if (line.trim() === "") return line;
        const currentIndentMatch = line.match(/^\s*/);
        const currentIndent = currentIndentMatch
            ? currentIndentMatch[0].length
            : 0;
        const newIndent = Math.max(0, currentIndent - parentIndent);
        return " ".repeat(newIndent) + line.substring(currentIndent);
    });
    return { blockLines: adjusted, removedCount: numLinesToMove };
}

/**
 * Insert a block of lines into the given `## sectionName` (or the
 * synthetic `# TODO` heading for "Default" / "TODO"). Creates the
 * heading if it doesn't exist. Handles the "Archive" special case
 * separately so the inserted block lands *after* any pre-existing
 * Archive items rather than at the top of Archive.
 */
function insertBlockIntoSection(
    lines: string[],
    sectionName: string,
    blockLines: string[]
): void {
    const isDefaultSection =
        sectionName.toLowerCase() === "default" ||
        sectionName.toLowerCase() === "todo";
    const isArchive = sectionName.toLowerCase() === "archive";

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
            if (
                lines.length > 0 &&
                lines[lines.length - 1]!.trim() !== ""
            ) {
                lines.push("");
            }
            lines.push(...blockLines);
        } else {
            let insertIndex = -1;
            for (let i = targetLineIndex + 1; i < lines.length; i++) {
                const line = lines[i]!.trim();
                if (line.startsWith("##") || line.startsWith("###")) {
                    let j = i;
                    while (
                        j > targetLineIndex + 1 &&
                        lines[j - 1]!.trim() === ""
                    ) {
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
                lines.splice(targetLineIndex + 1, 0, "", ...blockLines);
            } else {
                lines.splice(insertIndex, 0, ...blockLines);
            }
        }
        return;
    }

    // Named section (## or ###)
    let targetLineIndex = -1;
    const escapedName = sectionName.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );
    const sectionRe = new RegExp(
        `^(##+)\\s+${escapedName}\\b`,
        "i"
    );
    for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.match(sectionRe)) {
            targetLineIndex = i;
            break;
        }
    }

    if (targetLineIndex === -1) {
        if (
            lines.length > 0 &&
            lines[lines.length - 1]!.trim() !== ""
        ) {
            lines.push("");
        }
        lines.push(`## ${sectionName}`);
        lines.push(...blockLines);
        return;
    }

    // Archive: insert after any pre-existing Archive items, never at
    // the head (otherwise the new block would be interpreted as
    // nested under those items — see `archiveSection` for the
    // full rationale).
    if (isArchive) {
        let insertIndex = -1;
        for (let i = targetLineIndex + 1; i < lines.length; i++) {
            const line = lines[i]!.trim();
            if (line.startsWith("##") || line.startsWith("###")) {
                let j = i;
                while (
                    j > targetLineIndex + 1 &&
                    lines[j - 1]!.trim() === ""
                ) {
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
            lines.splice(targetLineIndex + 1, 0, "", ...blockLines);
        } else {
            lines.splice(insertIndex, 0, ...blockLines);
        }
        return;
    }

    // General named section: append at the end of the section, with
    // whitespace preserved.
    let insertIndex = lines.length;
    for (let i = targetLineIndex + 1; i < lines.length; i++) {
        if (
            lines[i]!.trim().startsWith("##") ||
            lines[i]!.trim().startsWith("###")
        ) {
            insertIndex = i;
            break;
        }
    }
    let lastNonEmpty = insertIndex - 1;
    while (
        lastNonEmpty > targetLineIndex &&
        lines[lastNonEmpty]!.trim() === ""
    ) {
        lastNonEmpty--;
    }

    if (lastNonEmpty === targetLineIndex) {
        const numBlankLines = insertIndex - (targetLineIndex + 1);
        lines.splice(
            targetLineIndex + 1,
            numBlankLines,
            "",
            ...blockLines
        );
    } else {
        const numBlankLines = insertIndex - (lastNonEmpty + 1);
        lines.splice(
            lastNonEmpty + 1,
            numBlankLines,
            ...blockLines
        );
    }

    const newInsertIndex =
        lastNonEmpty === targetLineIndex
            ? targetLineIndex + 1 + 1 + blockLines.length
            : lastNonEmpty + 1 + blockLines.length;
    if (
        newInsertIndex < lines.length &&
        lines[newInsertIndex]!.trim() !== ""
    ) {
        lines.splice(newInsertIndex, 0, "");
    }
}

/**
 * Move an item (plus its indented children) to another section.
 * Extracts the block from its current position, re-inserts at the
 * target. The children are re-indented so the whole block has the
 * same shape as if authored at the top level.
 */
export async function moveTodo(
    store: TodoStoreContext,
    item: TodoItem,
    sectionName: string
): Promise<void> {
    const fresh = await store.repository.read();
    if (fresh.items === null) return;
    const content = fresh.content;
    const lines = content.split("\n");
    if (item.line >= lines.length) return;

    const { blockLines } = extractBlock(lines, item);
    insertBlockIntoSection(lines, sectionName, blockLines);

    await store.writeAndLoad(lines);
}

/**
 * Apply `text` to the given `sectionName`. If `sectionName` is the
 * synthetic "Default" / "TODO" the item lands right after the
 * `# TODO` heading; for named sections it lands at the head of
 * that section, creating the heading if missing. If the file is
 * empty, seeds with `# TODO\n`.
 */
export async function addTodo(
    store: TodoStoreContext,
    text: string,
    sectionName: string
): Promise<void> {
    const fresh = await store.repository.read();
    // Missing file falls back to the same `# TODO` seed the
    // original code used; an empty string also seeds the file
    // because `applyAddTodo` always opens with that header.
    const seed = fresh.content || "# TODO\n";
    await applyAddTodo(store, seed, text, sectionName);
}

async function applyAddTodo(
    store: TodoStoreContext,
    content: string,
    text: string,
    sectionName: string
): Promise<void> {
    const lines = content.split("\n");
    const isDefaultSection =
        sectionName.toLowerCase() === "default" ||
        sectionName.toLowerCase() === "todo";

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
            if (
                lines.length > 0 &&
                lines[lines.length - 1]!.trim() !== ""
            ) {
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
                    while (
                        j > targetLineIndex + 1 &&
                        lines[j - 1]!.trim() === ""
                    ) {
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
                lines.splice(
                    targetLineIndex + 1,
                    0,
                    "",
                    `- [ ] ${text}`
                );
            } else {
                lines.splice(insertIndex, 0, `- [ ] ${text}`);
            }
        }
    } else {
        // Find `## sectionName` or `### sectionName`
        let targetLineIndex = -1;
        const escapedName = sectionName.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );
        const sectionRe = new RegExp(
            `^(##+)\\s+${escapedName}\\b`,
            "i"
        );
        for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.match(sectionRe)) {
                targetLineIndex = i;
                break;
            }
        }

        if (targetLineIndex === -1) {
            // Section does not exist. Append to the end.
            if (
                lines.length > 0 &&
                lines[lines.length - 1]!.trim() !== ""
            ) {
                lines.push("");
            }
            lines.push(`## ${sectionName}`);
            lines.push(`- [ ] ${text}`);
        } else {
            // Section exists. Find the end of the section.
            let insertIndex = lines.length;
            for (let i = targetLineIndex + 1; i < lines.length; i++) {
                if (
                    lines[i]!.trim().startsWith("##") ||
                    lines[i]!.trim().startsWith("###")
                ) {
                    insertIndex = i;
                    break;
                }
            }

            // Find the last non-empty line before insertIndex.
            let lastNonEmpty = insertIndex - 1;
            while (
                lastNonEmpty > targetLineIndex &&
                lines[lastNonEmpty]!.trim() === ""
            ) {
                lastNonEmpty--;
            }

            if (lastNonEmpty === targetLineIndex) {
                lines.splice(
                    targetLineIndex + 1,
                    0,
                    "",
                    `- [ ] ${text}`
                );
            } else {
                lines.splice(lastNonEmpty + 1, 0, `- [ ] ${text}`);
            }
        }
    }

    await store.writeAndLoad(lines);
}

/**
 * Move an item (plus its indented children) to `## Archive`,
 * stamping the date / state tags. If the item is already checked,
 * keeps it checked; if not, also completes the move so the user
 * sees the standard "@Completed @YYYY-MM-DD" archive metadata.
 */
export async function archiveTodo(
    store: TodoStoreContext,
    item: TodoItem
): Promise<void> {
    const fresh = await store.repository.read();
    if (fresh.items === null) return;
    const lines = fresh.content.split("\n");
    if (item.line >= lines.length) return;

    const dateStr = getFormattedDateTime();
    const re = /^(\s*[-*+]\s+)\[(\s|x|X)\]/;
    const m = lines[item.line]!.match(re);
    const isCompleted = m ? m[2]!.toLowerCase() === "x" : false;

    const { blockLines } = applyArchiveOrComplete(
        lines,
        item.line,
        isCompleted,
        dateStr
    );
    insertBlockIntoArchive(lines, blockLines);

    await store.writeAndLoad(lines);
}

/**
 * Reverse of `archiveTodo` — pull an item out of `## Archive` and
 * restore it to its original section (read from the
 * `@OriginalSection` tag). Strips the date / state tags from the
 * main line and unchecks the `[x]` checkbox: "rolling back" means
 * "this isn't actually done, bring it back to the working list", so
 * the item lands in its target section as pending regardless of
 * whether it was completed (`@Completed`) or just archived
 * (`@Archived`) when it left.
 */
export async function rollbackTodo(
    store: TodoStoreContext,
    item: TodoItem
): Promise<void> {
    const fresh = await store.repository.read();
    if (fresh.items === null) return;
    const lines = fresh.content.split("\n");
    if (item.line >= lines.length) return;

    const line = lines[item.line]!;
    const parsed = parseTagsFromLine(line);
    const targetSection = parsed?.sectionName || "Default";

    let mainLine = line.replace(TAGS_RE, "");
    mainLine = mainLine.replace(
        /^(\s*[-*+]\s+)\[(\s|x|X)\]/,
        "$1[ ]"
    );
    lines[item.line] = mainLine;

    const { blockLines } = extractBlock(lines, item);

    // Delegate to insertBlockIntoSection which knows how to handle
    // the "Default" / "TODO" synthetic target by inserting at the
    // head of `# TODO` (instead of creating a literal `## Default`
    // section — that's the documented behavior tested in
    // `todoArchiving.test.ts`).
    insertBlockIntoSection(lines, targetSection, blockLines);

    await store.writeAndLoad(lines);
}