// linkUtils — pure helpers used by the todoEngine factory for the
// openLink command. Kept separate so the factory can stay focused
// on command-id assembly and panel-neutral logic, and so these
// helpers can be unit-tested in isolation.
//
// `extractLink` mirrors the version in `src/todo/todoTreeProvider.ts`;
// the duplicate is intentional: the factory must not import from a
// panel module to keep the dependency direction one-way. When the
// refactor is fully landed, the panel-side copies can be removed
// and these become the single source of truth.

/**
 * Extract the first hyperlink (Markdown link target or raw HTTP/HTTPS
 * URL) from text. Returns `null` when no link is present.
 */
export function extractLink(text: string): string | null {
    // 1. Check for markdown link: [text](target)
    const markdownMatch = text.match(/\[[^\]]*\]\(([^)]+)\)/);
    if (markdownMatch) {
        return markdownMatch[1]!.trim();
    }
    // 2. Check for HTTP/HTTPS URL
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
        return urlMatch[0].trim();
    }
    return null;
}

/**
 * Kinds whose rows carry a hyperlink in `text`. Used by the Copy
 * command to decide whether the clipboard should receive the label
 * alone (plain checkbox/list/section/plan) or the label + the link
 * target on a second line.
 *
 * `*Archived` variants are included because the archive status is
 * purely visual (it changes icon + viewItem) and does not strip the
 * underlying link.
 */
const LINK_BEARING_KINDS = new Set<string>([
    "checkboxWithLink",
    "checkboxWithLinkArchived",
    "listWithLink",
    "listWithLinkArchived",
]);

/**
 * Format a `*WithLink` row for the Copy command as two lines:
 *   <label>
 *   <link target>
 *
 * The label keeps the original `[text](url)` Markdown syntax on line
 * 1 so the copy still reads as a meaningful description; the bare
 * target sits on line 2 so users can paste it straight into a
 * browser, terminal, or chat without unwrapping the Markdown. When
 * `extractLink` fails to find a target inside the label (e.g. the
 * text is a bare URL with no Markdown wrapping, or a label that
 * pretends to be a link but contains no `(...)`), the function
 * still returns two lines but the second line falls back to the
 * raw `item.text` — better than silently dropping the link the
 * user is reaching for.
 *
 * Returns `null` for non-link-bearing kinds so callers fall back to
 * copying the plain label via `item.text`.
 */
export function formatLinkCopyText(item: {
    readonly kind: string;
    readonly text: string;
}): string | null {
    if (!LINK_BEARING_KINDS.has(item.kind)) return null;
    const target = extractLink(item.text) ?? item.text;
    return `${item.text}\n${target}`;
}
