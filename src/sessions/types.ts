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
    readonly sessions: readonly SessionRecord[];
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
