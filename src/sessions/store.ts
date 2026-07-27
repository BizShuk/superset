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

type SessionParser = typeof parseSessionJsonl;

interface CachedSession {
    readonly sizeBytes: number;
    readonly mtimeMs: number;
    readonly record: SessionRecord;
}

/**
 * Filesystem boundary for the Sessions feature.
 *
 * `sessiond` records are append-only, so unchanged size + mtime identifies a
 * record that can safely reuse its parsed object. One store instance is shared
 * by the Tree View and summary renderer; watcher refreshes therefore stat every
 * candidate but only read and parse files that changed.
 */
export class SessionStore {
    private readonly cache = new Map<string, CachedSession>();
    private readonly cachedFilesByDir = new Map<string, Set<string>>();
    private cacheRoot?: string;

    constructor(
        private readonly dataDirOverride: () => string | undefined = () =>
            undefined,
        private readonly parse: SessionParser = parseSessionJsonl
    ) {}

    /** Every session recorded for `workspacePath`, newest first. */
    listSessions(workspacePath: string): SessionRecord[] {
        return this.listSessionsInDir(
            workspaceSessionsDir(workspacePath, this.currentOverride())
        );
    }

    /**
     * Session-bearing workspace buckets at or below `workspacePath`.
     *
     * The bucket path is the project identity. Meta is deliberately not used
     * for grouping because malformed or stale records must not escape their
     * bucket.
     */
    listSessionProjects(workspacePath: string): SessionProject[] {
        const root = this.root();
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

            const sessions = this.listSessionsInDir(path.join(root, entry.name));
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

    /** Read one session, reusing its parsed record while metadata is stable. */
    readSession(filePath: string): SessionRecord | undefined {
        try {
            const stat = fs.statSync(filePath);
            const cached = this.cache.get(filePath);
            if (
                cached?.sizeBytes === stat.size &&
                cached.mtimeMs === stat.mtimeMs
            ) {
                return cached.record;
            }

            const text = fs.readFileSync(filePath, "utf8");
            const record = this.parse(
                text,
                filePath,
                stat.size,
                stat.mtimeMs
            );
            this.remember(filePath, {
                sizeBytes: stat.size,
                mtimeMs: stat.mtimeMs,
                record,
            });
            return record;
        } catch {
            this.forget(filePath);
            return undefined;
        }
    }

    /**
     * Remove a generated sample fixture. Ingested session files are read-only
     * even if a caller bypasses the UI's context filtering.
     */
    deleteSession(filePath: string): boolean {
        if (!/^sample-.*\.jsonl$/.test(path.basename(filePath))) {
            return false;
        }
        try {
            fs.rmSync(filePath);
            this.forget(filePath);
            return true;
        } catch {
            return false;
        }
    }

    watch(
        workspacePath: string,
        onChange: () => void
    ): { dispose(): void } {
        return watchSessions(
            workspacePath,
            onChange,
            this.currentOverride()
        );
    }

    clearCache(): void {
        this.cache.clear();
        this.cachedFilesByDir.clear();
    }

    private root(): string {
        const root = sessionsRoot(this.currentOverride());
        if (this.cacheRoot !== root) {
            this.clearCache();
            this.cacheRoot = root;
        }
        return root;
    }

    private currentOverride(): string | undefined {
        return this.dataDirOverride();
    }

    private listSessionsInDir(dir: string): SessionRecord[] {
        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            this.evictMissing(dir, new Set());
            return [];
        }

        const observed = new Set<string>();
        const records: SessionRecord[] = [];
        for (const name of entries) {
            if (!name.endsWith(".jsonl")) continue;
            const filePath = path.join(dir, name);
            observed.add(filePath);
            const record = this.readSession(filePath);
            if (record) records.push(record);
        }

        this.evictMissing(dir, observed);
        records.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
        return records;
    }

    private remember(filePath: string, entry: CachedSession): void {
        this.cache.set(filePath, entry);
        const dir = path.dirname(filePath);
        const files = this.cachedFilesByDir.get(dir) ?? new Set<string>();
        files.add(filePath);
        this.cachedFilesByDir.set(dir, files);
    }

    private forget(filePath: string): void {
        this.cache.delete(filePath);
        const dir = path.dirname(filePath);
        const files = this.cachedFilesByDir.get(dir);
        files?.delete(filePath);
        if (files?.size === 0) this.cachedFilesByDir.delete(dir);
    }

    private evictMissing(dir: string, observed: ReadonlySet<string>): void {
        const cached = this.cachedFilesByDir.get(dir);
        if (!cached) return;
        for (const filePath of [...cached]) {
            if (!observed.has(filePath)) this.forget(filePath);
        }
    }
}

function isWorkspaceOrDescendant(root: string, candidate: string): boolean {
    if (!root || !candidate) return false;
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return (
        relative === "" ||
        (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
}

/** Compatibility helper for pure callers that do not need a retained cache. */
export function listSessions(
    workspacePath: string,
    override?: string
): SessionRecord[] {
    return new SessionStore(() => override).listSessions(workspacePath);
}

/** Compatibility helper for pure callers that do not need a retained cache. */
export function listSessionProjects(
    workspacePath: string,
    override?: string
): SessionProject[] {
    return new SessionStore(() => override).listSessionProjects(workspacePath);
}

/** Read a single session file, or `undefined` if it vanished. */
export function readSession(filePath: string): SessionRecord | undefined {
    return new SessionStore().readSession(filePath);
}

/** Delete sample data only; ingested session records are always read-only. */
export function deleteSession(filePath: string): boolean {
    return new SessionStore().deleteSession(filePath);
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
