// Single-line mutations — toggling the checkbox, changing the
// priority tag, renaming the text, or deleting the item. These four
// operations touch at most one logical item plus its children (no
// whole-block moves, no section restructuring), so they group
// naturally. Extracted from `TodoStore` as Plan 2 Stage A's
// `todoMutations.ts` slot.

import type { TodoItem } from "./types";
import {
    applyArchiveOrComplete,
    ensureArchiveIsLastSection,
    getFormattedDateTime,
    insertBlockIntoArchive,
    type TodoStoreContext,
} from "./todoBlockOps";
import { isArchivedTask, parseTagsFromLine, TAGS_RE, constructTags } from "./parser";

/**
 * Flip the `[ ]` ↔ `[x]` checkbox. For top-level items in non-Archive
 * sections the optimized path is used (write + emit `"toggled"`,
 * skipping a full reload — keeps the editor cursor stable). For
 * Archive items and top-level items in any section, the block is
 * archived or restored via the standard `applyArchiveOrComplete` /
 * `insertBlockIntoArchive` flow so the date stamp is updated.
 */
export async function toggleTodo(
    store: TodoStoreContext,
    item: TodoItem
): Promise<void> {
    const fresh = await store.repository.read();
    if (fresh.items === null) return;
    const content = fresh.content;
    const lines = content.split("\n");
    if (item.line >= lines.length) return;

    const re = /^(\s*[-*+]\s+)\[(\s|x|X)\](\s+.*)$/;
    const m = lines[item.line]!.match(re);
    if (!m) return;

    const isDone = m[2]!.toLowerCase() === "x";
    const isArchived =
        isArchivedTask(lines[item.line]!) ||
        item.parentSection?.toLowerCase() === "archive";

    if (isArchived) {
        const newMarker = isDone ? " " : "x";
        let mainLine = lines[item.line]!;
        mainLine = mainLine.replace(
            /^(\s*[-*+]\s+)\[(\s|x|X)\]/,
            `$1[${newMarker}]`
        );

        const parsed = parseTagsFromLine(mainLine);
        if (parsed) {
            const newState = isDone ? "Archived" : "Completed";
            const dateStr = getFormattedDateTime();
            mainLine = mainLine.replace(TAGS_RE, "");
            const tags = constructTags(
                dateStr,
                newState,
                parsed.sectionName || "Default"
            );
            mainLine = mainLine + tags;
        }
        lines[item.line] = mainLine;
        await store.writeAndLoad(lines);
    } else {
        const parentIndentMatch = lines[item.line]!.match(/^\s*/);
        const parentIndent = parentIndentMatch
            ? parentIndentMatch[0].length
            : 0;

        if (!isDone) {
            if (parentIndent === 0) {
                const dateStr = getFormattedDateTime();
                const { blockLines } = applyArchiveOrComplete(
                    lines,
                    item.line,
                    true,
                    dateStr
                );
                insertBlockIntoArchive(lines, blockLines);
                await store.writeAndLoad(lines);
            } else {
                const newMarker = "x";
                lines[item.line] = `${m[1]}[${newMarker}]${m[3]}`;
                const cleanedLines = ensureArchiveIsLastSection(lines);
                await store.repository.write(cleanedLines.join("\n"));
                item.checked = !item.checked;
                store.emit({ type: "toggled", item });
            }
        } else {
            const newMarker = " ";
            lines[item.line] = `${m[1]}[${newMarker}]${m[3]}`;
            const cleanedLines = ensureArchiveIsLastSection(lines);
            await store.repository.write(cleanedLines.join("\n"));
            item.checked = !item.checked;
            store.emit({ type: "toggled", item });
        }
    }
}

/**
 * Set or clear the `[P0]` / `[P1]` / `[P2]` tag on a single item.
 * Path 1: line already has a priority tag — replace or strip it.
 * Path 2: no priority prefix — insert `[Px] ` after the optional
 * checkbox marker.
 */
export async function updatePriority(
    store: TodoStoreContext,
    item: TodoItem,
    newPriority: "P0" | "P1" | "P2" | "None"
): Promise<void> {
    const result = await store.repository.read();
    if (result.items === null) return;
    const lines = result.content.split("\n");
    if (item.line >= lines.length) return;

    // Path 1: line already has a priority tag — replace or remove it.
    const replaceRe =
        /^(\s*[-*+]\s+(?:\[[^\]]*\]\s+)?)(?:\[|\()P[0-2](?:\]|\))(\s+.*)$/;
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
    await store.writeAndLoad(lines);
}

/**
 * Replace the visible text of a single item at `line`. Keeps the
 * checkbox marker and any leading whitespace intact; replaces only
 * the trailing description. Returns silently if the line doesn't
 * match a `- [ ]` / `- [x]` shape.
 */
export async function updateText(
    store: TodoStoreContext,
    line: number,
    newText: string
): Promise<void> {
    const fresh = await store.repository.read();
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

    await store.writeAndLoad(lines);
}

/**
 * Delete an item plus all of its indented children (recursive by
 * indentation, since markdown has no closing marker). The item's
 * own line plus every subsequent line with strictly greater indent
 * is removed in one `splice` call.
 */
export async function deleteTodo(
    store: TodoStoreContext,
    item: TodoItem
): Promise<void> {
    const fresh = await store.repository.read();
    if (fresh.items === null) return;
    const content = fresh.content;
    const lines = content.split("\n");
    if (item.line >= lines.length) return;

    const parentIndentMatch = lines[item.line]!.match(/^\s*/);
    const parentIndent = parentIndentMatch
        ? parentIndentMatch[0].length
        : 0;

    let lastChildLineIndex = item.line;
    for (let i = item.line + 1; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.trim() === "") {
            continue;
        }
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

    const numLinesToDelete = lastChildLineIndex - item.line + 1;
    lines.splice(item.line, numLinesToDelete);

    await store.writeAndLoad(lines);
}