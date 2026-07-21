// Sessions store — locate, parse and watch the `sessiond` JSONL output.
//
// The extension is a pure consumer (plan §7): it never writes session
// content and never parses a raw agent transcript. Everything here is
// filesystem + JSONL; the rendering lives in `markdown.ts` / `treeSpec.ts`
// as pure functions so they stay vitest-able without a `vscode` import.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
    SessionMeta,
    SessionProject,
    SessionRecord,
    SessionTurn,
} from "./types";

/** Mirror of Go `store.EncodeWorkspace` — `/` → `%2F`, one flat segment. */
export function encodeWorkspace(workspacePath: string): string {
    if (!workspacePath) return "_unknown";
    return workspacePath.split("/").join("%2F");
}

/** Mirror of Go `store.DecodeWorkspace`. */
export function decodeWorkspace(segment: string): string {
    if (segment === "_unknown") return "";
    return segment.split("%2F").join("/");
}

/**
 * Root of the shared store. `gosdk` fixes the app config dir at
 * `~/.config/<appName>`, so the sessions root is derived, not configurable
 * on the Go side — the override exists only to point the panel at a
 * scratch dir during development.
 */
export function sessionsRoot(override?: string): string {
    if (override && override.trim()) {
        return expandHome(override.trim());
    }
    return path.join(os.homedir(), ".config", "superset", "data", "sessions");
}

function expandHome(p: string): string {
    return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Directory holding every session of one workspace. */
export function workspaceSessionsDir(
    workspacePath: string,
    override?: string
): string {
    return path.join(sessionsRoot(override), encodeWorkspace(workspacePath));
}

/**
 * Parse one JSONL payload. Pure — no filesystem access — so the JSONL
 * contract can be tested against fixtures.
 *
 * Tolerates: a missing/!meta first line (synthesises a placeholder from
 * the filename), unknown record types, and a torn final line (the Go side
 * appends while we read).
 */
export function parseSessionJsonl(
    text: string,
    filePath: string,
    sizeBytes: number,
    mtimeMs: number
): SessionRecord {
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const turns: SessionTurn[] = [];
    let meta: SessionMeta | undefined;
    let malformedLines = 0;

    for (const line of lines) {
        let rec: unknown;
        try {
            rec = JSON.parse(line);
        } catch {
            malformedLines++;
            continue;
        }
        const type = (rec as { type?: string })?.type;
        if (type === "meta" && !meta) {
            meta = rec as SessionMeta;
        } else if (type === "turn") {
            turns.push(rec as SessionTurn);
        } else {
            malformedLines++;
        }
    }

    const fallbackId = path.basename(filePath).replace(/\.jsonl$/, "");
    const resolvedMeta: SessionMeta = meta ?? {
        type: "meta",
        agent: "unknown",
        session_id: fallbackId,
        workspace_path: decodeWorkspace(path.basename(path.dirname(filePath))),
        title: fallbackId,
        created_at: new Date(mtimeMs).toISOString(),
        schema_version: 0,
    };

    turns.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    return {
        meta: resolvedMeta,
        turns,
        filePath,
        sizeBytes,
        lastActiveMs: lastActivity(turns, mtimeMs),
        malformedLines,
    };
}

/**
 * The last turn's own timestamp wins; file mtime is only the fallback for a
 * session with no timestamped turn. (Not `max(turn, mtime)` — mtime moves for
 * reasons that are not session activity, e.g. a copied or re-seeded store,
 * and would then report every session as active "just now".)
 */
function lastActivity(turns: readonly SessionTurn[], mtimeMs: number): number {
    const last = turns[turns.length - 1];
    const parsed = last?.at ? Date.parse(last.at) : NaN;
    return Number.isFinite(parsed) ? parsed : mtimeMs;
}

/**
 * Every session recorded for `workspacePath`, newest first. A missing
 * directory is the normal "no sessions yet" state, not an error.
 */
export function listSessions(
    workspacePath: string,
    override?: string
): SessionRecord[] {
    return listSessionsInDir(workspaceSessionsDir(workspacePath, override));
}

/**
 * Session-bearing workspace buckets at or below `workspacePath`.
 *
 * The bucket path is the project identity. Meta is deliberately not used for
 * grouping because malformed or stale records must not escape their bucket.
 */
export function listSessionProjects(
    workspacePath: string,
    override?: string
): SessionProject[] {
    const root = sessionsRoot(override);
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return [];
    }

    const projects: SessionProject[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const projectPath = decodeWorkspace(entry.name);
        if (!isWorkspaceOrDescendant(workspacePath, projectPath)) continue;

        const sessions = listSessionsInDir(path.join(root, entry.name));
        if (sessions.length === 0) continue;
        projects.push({ projectPath, sessions });
    }

    projects.sort((a, b) => {
        if (a.projectPath === workspacePath) return -1;
        if (b.projectPath === workspacePath) return 1;
        return path
            .relative(workspacePath, a.projectPath)
            .localeCompare(path.relative(workspacePath, b.projectPath));
    });
    return projects;
}

function isWorkspaceOrDescendant(root: string, candidate: string): boolean {
    if (!root || !candidate) return false;
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function listSessionsInDir(dir: string): SessionRecord[] {
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return [];
    }

    const records: SessionRecord[] = [];
    for (const name of entries) {
        if (!name.endsWith(".jsonl")) continue;
        const filePath = path.join(dir, name);
        try {
            const stat = fs.statSync(filePath);
            const text = fs.readFileSync(filePath, "utf8");
            records.push(
                parseSessionJsonl(text, filePath, stat.size, stat.mtimeMs)
            );
        } catch {
            // Unreadable or deleted mid-scan — skip rather than fail the panel.
        }
    }

    records.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
    return records;
}

/** Read a single session file, or `undefined` if it vanished. */
export function readSession(filePath: string): SessionRecord | undefined {
    try {
        const stat = fs.statSync(filePath);
        const text = fs.readFileSync(filePath, "utf8");
        return parseSessionJsonl(text, filePath, stat.size, stat.mtimeMs);
    } catch {
        return undefined;
    }
}

/** Remove a session's backing file. Returns false if it was already gone. */
export function deleteSession(filePath: string): boolean {
    try {
        fs.rmSync(filePath, { force: true });
        return true;
    } catch {
        return false;
    }
}

/**
 * Watch the workspace's session dir for ingestor writes.
 *
 * The dir often does not exist yet (no session recorded for this folder),
 * so we fall back to watching the sessions root recursively — that covers
 * "the dir gets created later" without a polling loop. Both watchers are
 * best-effort: on any platform error the panel still works via manual
 * refresh.
 */
export function watchSessions(
    _workspacePath: string,
    onChange: () => void,
    override?: string
): { dispose(): void } {
    const watchers: fs.FSWatcher[] = [];
    let timer: NodeJS.Timeout | undefined;
    const debounced = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
    };

    // Watch the shared root so changes in existing descendant buckets and new
    // project buckets are both observed. Missing roots degrade to refresh-only.
    tryWatch(sessionsRoot(override), true, debounced, watchers);

    return {
        dispose() {
            if (timer) clearTimeout(timer);
            for (const w of watchers) {
                try {
                    w.close();
                } catch {
                    /* already closed */
                }
            }
        },
    };
}

const WATCH_DEBOUNCE_MS = 300;

function tryWatch(
    dir: string,
    recursive: boolean,
    onChange: () => void,
    sink: fs.FSWatcher[]
): void {
    try {
        sink.push(fs.watch(dir, { recursive }, onChange));
    } catch {
        // Directory absent or watch limit hit — caller degrades gracefully.
    }
}
