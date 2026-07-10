// linkUtils — the single source of truth for todo-link parsing/resolution
// helpers shared by the `todo` and `projectsTodo` panels (and the
// `todoEngine` command factory that serves both).
//
// History: `extractLink` / `resolveTodoLink` / `cleanLabelText` previously
// lived in `src/todo/todoTreeProvider.ts`, with a mirror-copy of
// `extractLink` here and a third copy (`resolveTodoLinkFactory`) in
// `commandFactory.ts`. The duplication existed because the factory must
// not import from a panel module (one-way dependency direction). Now
// that this module is the canonical home, the panel-side copies are
// removed and the factory's local copy is deleted — one implementation,
// imported from here by all three consumers.
//
// All functions are pure (no I/O, no `vscode`), so they are unit-tested
// in isolation in `test/todoEngine/linkUtils.test.ts` and
// `test/todoTreeProvider.test.ts`.

import * as path from "node:path";

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
 * Replace markdown links `[text](target)` with just the link text, so
 * a row label renders without the trailing URL.
 */
export function cleanLabelText(text: string): string {
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

export interface ResolvedLink {
    readonly type: "url" | "file";
    readonly uriOrPath: string;
}

/**
 * Resolve a todo link target to a full path or URL, taking into
 * account workspace-relative paths and `file://` protocols.
 *
 * - `http(s)://...` and `file:///...` (three slashes) are treated as
 *   absolute URLs and returned verbatim.
 * - `file://<path>` (two slashes) is stripped of the `file://` prefix
 *   and then treated as a path.
 * - Absolute paths (`/...`) are returned as-is.
 * - Everything else is joined onto `workspaceFolder`.
 */
export function resolveTodoLink(
    target: string,
    workspaceFolder: string
): ResolvedLink {
    if (
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("file:///")
    ) {
        return { type: "url", uriOrPath: target };
    }

    let cleanPath = target;
    if (target.startsWith("file://")) {
        cleanPath = target.substring("file://".length);
    }

    const resolvedPath = path.isAbsolute(cleanPath)
        ? cleanPath
        : path.join(workspaceFolder, cleanPath);

    return { type: "file", uriOrPath: resolvedPath };
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
