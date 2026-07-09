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
