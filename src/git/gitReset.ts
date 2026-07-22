// gitReset — pure helpers for the SCM Graph commit-context "Reset
// Hard" / "Reset Soft" menu entries. No `vscode` import on purpose:
// this file stays testable under plain vitest without mocking the
// entire extension host surface. Same SRP split as `todo/parser.ts`
// and `mdns/parser.ts`.
//
// Heavy orchestration (UI prompts, terminal spawn, post-refresh) is
// in `./index.ts`; this file only deals with arg parsing, cmdline
// building, and warning text composition.

export type ResetMode = "hard" | "soft";

const SHORT_SHA_LEN = 7;
const SUBJECT_MAX_LEN = 80;

/**
 * Minimal duck-typed shape of a `vscode.SourceControlHistoryItem`.
 * We only need the commit SHA (`id`) and the human-readable subject
 * (`message`) for the modal — a duck-typed shape keeps this file
 * free of `vscode` imports.
 */
export interface HistoryItemLike {
    readonly id: string;
    readonly message?: string;
}

/**
 * Minimal duck-typed shape of a `vscode.SourceControl` repository.
 * The only field we care about is `rootUri.fsPath` so we can anchor
 * `spawnRunTerminal`'s cwd to the right repo.
 */
export interface RepositoryLike {
    readonly rootUri?: { readonly fsPath: string } | undefined;
}

/**
 * Pull `(repository, historyItem)` out of the raw argument vector
 * VSCode passes to a command invoked from `scm/historyItem/context`.
 *
 * Right-clicking a commit in the Source Control Graph panel invokes
 * the command with `(SourceControl, SourceControlHistoryItem)`. The
 * command palette passes no args — we return nulls and let the
 * caller surface a hint to the user.
 *
 * The shape check is intentionally permissive: anything that isn't
 * a `{rootUri?: {fsPath: string}}` plus `{id: string}` pair is
 * rejected. We don't import `vscode` types here — that would force
 * test files to mock the whole module just to call this helper.
 */
export function parseScmArgs(args: unknown): {
    readonly repository: RepositoryLike | null;
    readonly historyItem: HistoryItemLike | null;
} {
    if (!Array.isArray(args) || args.length < 2) {
        return { repository: null, historyItem: null };
    }
    const [repo, item] = args;
    if (!isRepositoryLike(repo) || !isHistoryItemLike(item)) {
        return { repository: null, historyItem: null };
    }
    return { repository: repo, historyItem: item };
}

function isRepositoryLike(value: unknown): value is RepositoryLike {
    if (typeof value !== "object" || value === null) return false;
    const v = value as { rootUri?: unknown };
    if (v.rootUri === undefined) return true; // rootUri is optional
    if (typeof v.rootUri !== "object" || v.rootUri === null) return false;
    const r = v.rootUri as { fsPath?: unknown };
    return typeof r.fsPath === "string";
}

function isHistoryItemLike(value: unknown): value is HistoryItemLike {
    if (typeof value !== "object" || value === null) return false;
    const v = value as { id?: unknown };
    return typeof v.id === "string";
}

/**
 * Build the shell cmdline for `git reset --<mode> <sha>`. The SHA
 * is single-quote-wrapped via the local `quoteShellArg` helper so
 * the cmdline is safe even if a future provider returns an
 * unexpectedly-shaped id. `spawnRunTerminal` will append `&& exit`
 * on its own when the caller passes `closeOnSuccess: true`.
 */
export function buildResetCmdline(sha: string, mode: ResetMode): string {
    return `git reset --${mode} ${quoteShellArg(sha)}`;
}

/**
 * Compose the modal warning text shown before `reset --hard`.
 * Includes the short commit SHA (first 7 chars) and the commit's
 * subject line, truncated to 80 chars so the dialog stays readable
 * even for messages with RFC-style wrapped bodies. Falls back to
 * `(no subject)` when the commit message is missing or empty.
 *
 * Output is intentionally in 繁體中文 to match the project's copy
 * style (see `src/installCommands.ts` installDefaultProject modal
 * for the convention).
 */
export function formatResetHardWarning(
    sha: string,
    subject: string | undefined
): string {
    const shortSha = sha.length > SHORT_SHA_LEN
        ? sha.slice(0, SHORT_SHA_LEN)
        : sha || "(unknown)";
    const trimmed = subject?.trim() ?? "";
    const safeSubject = trimmed.length > 0 ? trimmed : "(no subject)";
    const truncated =
        safeSubject.length > SUBJECT_MAX_LEN
            ? `${safeSubject.slice(0, SUBJECT_MAX_LEN)}…`
            : safeSubject;

    return [
        `Superset: 即將執行 \`git reset --hard ${shortSha}\` 並丟棄後續狀態。`,
        "",
        `Commit: ${truncated}`,
        "",
        "所有未 commit 的 working tree 變更,以及 HEAD 與目標 commit 之間的提交",
        "都會**永久丟失**(reflog 之外無法回復)。",
        "",
        "確認繼續?",
    ].join("\n");
}

/**
 * Single-quote-wrap a shell argument. Mirrors `spawnRunTerminal`'s
 * `quoteShellArg` so behavior stays identical; re-implemented here
 * to keep `gitReset.ts` independent of any filesystem / `vscode`
 * surface. Empty string is rendered as `''`.
 */
function quoteShellArg(value: string): string {
    if (value === "") return "''";
    return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Pick the short SHA used for terminal names / log lines. Falls back
 * to the full SHA when the commit id is short enough that the slice
 * would be empty — VSCode's history provider generally returns the
 * 40-char SHA, but defensiveness here costs nothing.
 */
export function shortSha(sha: string): string {
    return sha.length > SHORT_SHA_LEN ? sha.slice(0, SHORT_SHA_LEN) : sha;
}
