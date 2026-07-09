// Whole-section operations — archive / unarchive / delete an
// entire heading-and-its-content block. Distinct from
// `todoMutations` (which acts on a single item) and from
// `todoMoveOps` (which moves a block across sections). Extracted
// from `TodoStore` as Plan 2 Stage A's `todoSectionOps.ts` slot.

import type { TodoItem } from "./types";
import {
    findArchiveHeadingIndex,
    findSectionBlockEnd,
    fixAdjacentHeadings,
    stripTrailingBlank,
    type TodoStoreContext,
} from "./todoBlockOps";

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
export async function archiveSection(
    store: TodoStoreContext,
    item: TodoItem
): Promise<void> {
    if (item.line < 0 || item.level === undefined) return;
    const fresh = await store.repository.read();
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
        if (
            lines.length > 0 &&
            lines[lines.length - 1]!.trim() !== ""
        ) {
            lines.push("");
        }
        lines.push("## Archive", "", ...blockLines);
    } else {
        const sectionEnd = findSectionBlockEnd(lines, archiveIndex, 2);
        let lastNonBlank = sectionEnd - 1;
        while (
            lastNonBlank > archiveIndex &&
            lines[lastNonBlank]!.trim() === ""
        ) {
            lastNonBlank--;
        }
        const insertAt =
            lastNonBlank === archiveIndex
                ? archiveIndex + 1
                : lastNonBlank + 1;
        lines.splice(insertAt, sectionEnd - insertAt, "", ...blockLines);

        // If Archive isn't the last section, keep a single blank line
        // separating our appended block from whatever heading follows.
        const afterBlock = insertAt + 1 + blockLines.length;
        if (
            afterBlock < lines.length &&
            lines[afterBlock]!.trim() !== ""
        ) {
            lines.splice(afterBlock, 0, "");
        }
    }

    await store.writeAndLoad(lines);
}

/**
 * Reverse of `archiveSection`: move a `###` subsection nested under
 * `## Archive` back out to the top level, promoting its heading to
 * `##`. Inserted right before the `## Archive` heading so Archive
 * stays the last section. No-op unless `item.level === 3`.
 */
export async function unarchiveSection(
    store: TodoStoreContext,
    item: TodoItem
): Promise<void> {
    if (item.line < 0 || item.level !== 3) return;
    const fresh = await store.repository.read();
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
        if (
            lines.length > 0 &&
            lines[lines.length - 1]!.trim() !== ""
        ) {
            lines.push("");
        }
        lines.push(...blockLines);
    } else {
        lines.splice(archiveIndex, 0, ...blockLines, "");
    }

    await store.writeAndLoad(lines);
}

/**
 * Delete an entire section plus its body. The Default section is
 * identified by `item.text === "Default"` and `item.line < 0` (no
 * heading line in the markdown). For headed sections the body is
 * everything up to the next heading of any depth. Adjacent-heading
 * whitespace is preserved (insert a blank line so two headings
 * never end up directly stacked).
 */
export async function deleteSection(
    store: TodoStoreContext,
    item: TodoItem
): Promise<void> {
    const fresh = await store.repository.read();
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

        await store.writeAndLoad(lines);
    }
}