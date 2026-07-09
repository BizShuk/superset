/**
 * Pure-function mermaid detector for terminal output.
 *
 * Convention:
 *   A "trigger line" is a line whose trimmed content equals `mermaid`
 *   (case-insensitive). The body runs from the *next* line through the
 *   line BEFORE the first fully-empty line, or through end-of-buffer
 *   if no terminator appears (TUI redraws may truncate mid-stream).
 *
 *   mermaid
 *   graph TD
 *     A --> B
 *     B --> C
 *                            ← empty line terminates the body
 *
 * The trigger consumes any line-equality match, so the detector stays
 * predictable — no false positives from "show mermaid diagram" prose
 * that happens to share words with the surrounding commands.
 *
 * Pure by design: no I/O, no `vscode` imports, so the parser can be
 * unit-tested without the host. Buffers arrive as plain `string[]`,
 * one entry per render-line (callers are responsible for splitting
 * their data stream — typically per newline, with ANSI stripping).
 */

export interface MermaidMatch {
    /** Zero-based index into the input buffer of the trigger line. */
    triggerLine: number;
    /** Zero-based indices of body lines (each `>= triggerLine + 1`). */
    bodyLines: readonly number[];
    /** Trimmed, joined body text, ready to feed a mermaid renderer. */
    bodyText: string;
    /** Range (start, end) into the trigger line to underline. */
    triggerRange: { start: number; end: number };
}

const TRIGGER_KEYWORD = "mermaid";

/**
 * Locate the *first* mermaid match in `buffer`, starting from `fromIndex`.
 * Returns `null` if no trigger line is found at or after the cursor.
 *
 * `fromIndex` exists so the link provider can re-scan on each new line
 * without re-detecting an already-emitted match (cheap O(n) walk).
 */
export function findFirstMermaidMatch(
    buffer: readonly string[],
    fromIndex = 0
): MermaidMatch | null {
    const triggerLine = locateTriggerLine(buffer, fromIndex);
    if (triggerLine < 0) {
        return null;
    }
    const rawTrigger = buffer[triggerLine] ?? "";
    const triggerRange = computeTriggerRange(rawTrigger);
    const bodyLines: number[] = [];
    for (let i = triggerLine + 1; i < buffer.length; i++) {
        const line = buffer[i] ?? "";
        if (isTerminatorLine(line)) {
            break;
        }
        bodyLines.push(i);
    }
    const bodyText = collectBodyText(buffer, bodyLines);
    return { triggerLine, bodyLines, bodyText, triggerRange };
}

/**
 * Find every non-overlapping match in `buffer`. Useful for tests and
 * for callers that want a snapshot view (the link provider prefers
 * `findFirstMermaidMatch` because it scans lazily).
 */
export function findAllMermaidMatches(
    buffer: readonly string[]
): MermaidMatch[] {
    const matches: MermaidMatch[] = [];
    let cursor = 0;
    while (cursor < buffer.length) {
        const match = findFirstMermaidMatch(buffer, cursor);
        if (!match) {
            break;
        }
        matches.push(match);
        // Skip past the body so we don't re-trigger on a "mermaid"
        // keyword that happens to appear inside the diagram itself.
        cursor = match.bodyLines.length > 0
            ? (match.bodyLines[match.bodyLines.length - 1] ?? cursor) + 1
            : match.triggerLine + 1;
    }
    return matches;
}

function locateTriggerLine(
    buffer: readonly string[],
    fromIndex: number
): number {
    const start = Math.max(0, fromIndex);
    for (let i = start; i < buffer.length; i++) {
        if (isTriggerLine(buffer[i] ?? "")) {
            return i;
        }
    }
    return -1;
}

function isTriggerLine(line: string): boolean {
    return line.trim().toLowerCase() === TRIGGER_KEYWORD;
}

/**
 * A "fully empty" terminator is a line that is empty after `trimEnd()`
 * (no characters before trim, no characters after). Leading whitespace
 * is OK because shell prompts and TUI frames often pad the left margin,
 * so we permit indent on both trigger and body lines.
 *
 * The terminator rule: zero content length after stripping trailing
 * whitespace. That excludes lines that are only ANSI OSC sequences or
 * only spaces — they still terminate the block (their visual
 * information content is zero from the diagram's perspective).
 */
function isTerminatorLine(line: string): boolean {
    return line.trimEnd().length === 0;
}

function computeTriggerRange(line: string): { start: number; end: number } {
    // Trim leading whitespace and find where the keyword begins/ends.
    const leadingLen = line.length - line.trimStart().length;
    const keyword = TRIGGER_KEYWORD;
    const start = leadingLen;
    const end = start + keyword.length;
    return { start, end };
}

function collectBodyText(
    buffer: readonly string[],
    bodyLines: readonly number[]
): string {
    if (bodyLines.length === 0) {
        return "";
    }
    return bodyLines.map((i) => buffer[i] ?? "").join("\n");
}
