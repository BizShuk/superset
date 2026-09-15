// Domain types for the Sessions panel — the read-only mirror of the
// `sessiond` on-disk contract (`sessiond/internal/model/session.go`).
//
// One session = one append-only JSONL file:
//   <dataDir>/sessions/<%2F-encoded-workspace>/<session_id>.jsonl
// line 1 = `meta`, every later line = `turn`.
//
// The extension only ever READS this. Parsing is defensive: an unknown
// `type`, a truncated tail line, or a future `schema_version` must
// degrade to "show what we can", never throw.

export const SESSIONS_SCHEMA_VERSION = 1;

export type SessionAgent = "claude" | "codex" | "grok" | "antigravity";

/** How to bring a session back to life. */
export interface SessionResume {
    readonly kind: string; // "terminal"
    readonly command: string;
    readonly cwd: string;
}

/** First JSONL line. Written once by the Go ingestor. */
export interface SessionMeta {
    readonly type: "meta";
    readonly agent: string;
    readonly session_id: string;
    readonly workspace_path: string;
    readonly title: string;
    readonly resume?: SessionResume;
    readonly created_at: string;
    readonly schema_version: number;
}

/**
 * Optional per-turn tool record. Additive to schema v1 — the Go side
 * writes it with `omitempty`, so older files simply have no `tools`
 * key and render as a turn without H3 sections.
 */
export interface SessionToolCall {
    readonly name: string;
    readonly input?: string;
    readonly result?: string;
    readonly status?: string; // ok | error
    readonly duration_ms?: number;
}

/** Every JSONL line after the first. */
export interface SessionTurn {
    readonly type: "turn";
    readonly index: number;
    readonly turn_id?: string;
    readonly event: string;
    readonly user: string;
    readonly summary: string;
    readonly source: string; // heuristic | llm | native
    readonly status: string; // ok | error
    readonly at: string;
    readonly tools?: readonly SessionToolCall[];
}

export interface SessionProject {
    /** Canonical workspace path decoded from the store bucket name. */
    readonly projectPath: string;
    readonly sessions: readonly SessionSummary[];
}

/**
 * What a session row needs, and nothing else.
 *
 * The panel shows a title, an agent icon, a size, a turn count and an age —
 * none of which require the turns themselves. Keeping only this in the store's
 * cache is the difference between a footprint set by the number of sessions on
 * disk and one set by their total transcript bytes: every turn carries the
 * user text, the summary and each tool call's input and result, so a retained
 * {@link SessionRecord} per file grows without bound as agents keep writing.
 * Turn content is read on demand by the Markdown renderer and dropped again.
 */
export interface SessionSummary {
    readonly meta: SessionMeta;
    /** Number of turns, in place of the turns. */
    readonly turnCount: number;
    /** Absolute path of the backing `.jsonl`. */
    readonly filePath: string;
    /** Byte size on disk — surfaced as the dim row description. */
    readonly sizeBytes: number;
    /** Newest of (last turn `at`, file mtime) as epoch millis. */
    readonly lastActiveMs: number;
    /** Lines that failed to parse. Non-zero means drift worth showing. */
    readonly malformedLines: number;
}

export interface SessionRecord {
    readonly meta: SessionMeta;
    readonly turns: readonly SessionTurn[];
    /** Absolute path of the backing `.jsonl`. */
    readonly filePath: string;
    /** Byte size on disk — surfaced as the dim row description. */
    readonly sizeBytes: number;
    /** Newest of (last turn `at`, file mtime) as epoch millis. */
    readonly lastActiveMs: number;
    /** Lines that failed to parse. Non-zero means drift worth showing. */
    readonly malformedLines: number;
}
