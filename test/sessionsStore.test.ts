import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, describe, it, expect } from "vitest";
import {
    decodeWorkspace,
    encodeWorkspace,
    listSessions,
    parseSessionJsonl,
} from "../src/sessions/store";
import { buildSessionRow } from "../src/sessions/treeSpec";
import { renderSessionMarkdown, formatAge } from "../src/sessions/markdown";
import {
    renderSampleJsonl,
    sampleCoverage,
    writeSampleSessions,
} from "../src/sessions/sampleData";
import {
    SESSION_DOC_SCHEME,
    type SessionDocUri,
    sessionDocUri,
    sessionPathFromDocUri,
} from "../src/sessions/docUri";

/**
 * A foreign URI shape that satisfies the structural `SessionDocUri` type.
 * The helper must not accept it: only `SESSION_DOC_SCHEME` is recognised.
 */
const foreignUri = (scheme: string, path: string, query = ""): SessionDocUri => ({
    scheme,
    path,
    query,
    with(opts) {
        return { ...this, ...opts };
    },
});

const META = {
    type: "meta",
    agent: "claude",
    session_id: "70471642",
    workspace_path: "/Users/shuk/projects/tmp/superset",
    title: "探查 agent session 格式",
    resume: {
        kind: "terminal",
        command: "claude --resume 70471642",
        cwd: "/Users/shuk/projects/tmp/superset",
    },
    created_at: "2026-07-20T10:00:00.000Z",
    schema_version: 1,
};

function turn(index: number, extra: Record<string, unknown> = {}) {
    return {
        type: "turn",
        index,
        event: "Stop",
        user: `prompt ${index}`,
        summary: `summary ${index}`,
        source: "llm",
        status: "ok",
        at: `2026-07-20T10:0${index}:00.000Z`,
        ...extra,
    };
}

function jsonl(...records: unknown[]): string {
    return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

const FILE = "/store/sessions/%2Fw/70471642.jsonl";

describe("workspace path encoding", () => {
    it("round-trips through the Go %2F segment encoding", () => {
        const p = "/Users/shuk/projects/tmp/superset";
        expect(encodeWorkspace(p)).toBe(
            "%2FUsers%2Fshuk%2Fprojects%2Ftmp%2Fsuperset"
        );
        expect(decodeWorkspace(encodeWorkspace(p))).toBe(p);
    });

    it("maps an empty path to the _unknown bucket", () => {
        expect(encodeWorkspace("")).toBe("_unknown");
        expect(decodeWorkspace("_unknown")).toBe("");
    });
});

describe("parseSessionJsonl", () => {
    it("splits the meta line from the appended turns", () => {
        const rec = parseSessionJsonl(
            jsonl(META, turn(1), turn(2)),
            FILE,
            512,
            0
        );
        expect(rec.meta.title).toBe("探查 agent session 格式");
        expect(rec.turns).toHaveLength(2);
        expect(rec.malformedLines).toBe(0);
    });

    it("keeps parsed turns when the tail line is torn mid-append", () => {
        const text = jsonl(META, turn(1)) + '{"type":"turn","inde';
        const rec = parseSessionJsonl(text, FILE, 100, 0);
        expect(rec.turns).toHaveLength(1);
        expect(rec.malformedLines).toBe(1);
    });

    it("synthesises meta from the filename when the meta line is missing", () => {
        const rec = parseSessionJsonl(jsonl(turn(1)), FILE, 10, 1_700_000_000_000);
        expect(rec.meta.session_id).toBe("70471642");
        expect(rec.meta.workspace_path).toBe("/w");
        expect(rec.meta.schema_version).toBe(0);
    });

    it("orders turns by index regardless of file order", () => {
        const rec = parseSessionJsonl(jsonl(META, turn(3), turn(1)), FILE, 10, 0);
        expect(rec.turns.map((t) => t.index)).toEqual([1, 3]);
    });

    it("derives lastActive from the newest turn timestamp", () => {
        const rec = parseSessionJsonl(jsonl(META, turn(1), turn(2)), FILE, 10, 0);
        expect(rec.lastActiveMs).toBe(Date.parse("2026-07-20T10:02:00.000Z"));
    });

    it("falls back to file mtime when no turn carries a timestamp", () => {
        const rec = parseSessionJsonl(jsonl(META), FILE, 10, 42_000);
        expect(rec.lastActiveMs).toBe(42_000);
    });
});

describe("buildSessionRow", () => {
    it("puts size, turn count and age in the dim description", () => {
        const rec = parseSessionJsonl(jsonl(META, turn(1)), FILE, 2_048, 0);
        const now = rec.lastActiveMs + 2 * 60 * 60 * 1000;
        const row = buildSessionRow(rec, now);
        expect(row.label).toBe("探查 agent session 格式");
        expect(row.description).toBe("2.0 KB · 1 turn · 2h ago");
        expect(row.tooltip).toContain("claude · 70471642");
        expect(row.iconId).toBe("sparkle");
    });

    it("falls back to a neutral icon for an unknown agent", () => {
        const rec = parseSessionJsonl(
            jsonl({ ...META, agent: "hermes" }),
            FILE,
            10,
            0
        );
        expect(buildSessionRow(rec, 0).iconId).toBe("circle-outline");
    });
});

describe("formatAge", () => {
    it("degrades from minutes to days", () => {
        const now = 10 * 24 * 60 * 60 * 1000;
        expect(formatAge(now, now)).toBe("just now");
        expect(formatAge(now - 5 * 60_000, now)).toBe("5m ago");
        expect(formatAge(now - 3 * 3_600_000, now)).toBe("3h ago");
        expect(formatAge(now - 25 * 3_600_000, now)).toBe("yesterday");
        expect(formatAge(now - 72 * 3_600_000, now)).toBe("3d ago");
    });
});

describe("renderSessionMarkdown", () => {
    const withTools = parseSessionJsonl(
        jsonl(
            META,
            turn(1, {
                tools: [
                    {
                        name: "Bash",
                        input: "go test ./...",
                        result: "ok  0.212s",
                        status: "ok",
                        duration_ms: 2_140,
                    },
                ],
            }),
            turn(2, { status: "error" })
        ),
        FILE,
        1_024,
        0
    );
    const md = renderSessionMarkdown(withTools);

    it("uses H1 for the session title", () => {
        expect(md.split("\n")[0]).toBe("# 探查 agent session 格式");
        expect(md.match(/^# /gm)).toHaveLength(1);
    });

    it("uses H2 per round", () => {
        expect(md).toContain("## Round 1 — prompt 1");
        expect(md).toContain("## Round 2 — prompt 2 ❌");
        // summary is the body text, not a repeat of the heading
        expect(md).toContain("summary 1");
    });

    it("uses H3 for tool execution and result", () => {
        expect(md).toContain("### 🔧 Bash · 2140ms");
        expect(md).toContain("go test ./...");
        expect(md).toContain("ok  0.212s");
    });

    it("appends a runnable resume block", () => {
        expect(md).toContain("claude --resume 70471642");
    });

    it("states the empty case instead of rendering a bare title", () => {
        const empty = renderSessionMarkdown(
            parseSessionJsonl(jsonl(META), FILE, 10, 0)
        );
        expect(empty).toContain("尚無 turn 記錄");
    });
});

describe("sample fixture matrix", () => {
    // Seeded into a temp dir, then read back through the real code path the
    // panel uses — so a sample that stops covering its branch fails here.
    const dir = mkdtempSync(path.join(tmpdir(), "superset-sessions-"));
    const WS = "/Users/shuk/projects/tmp/superset";
    const NOW = Date.parse("2026-07-20T12:00:00.000Z");
    writeSampleSessions(WS, NOW, dir);
    const records = listSessions(WS, dir);
    const byId = new Map(records.map((r) => [r.meta.session_id, r]));
    const md = (id: string) => renderSessionMarkdown(byId.get(id)!);

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("seeds every sample and sorts newest first", () => {
        expect(records.length).toBeGreaterThanOrEqual(8);
        const ages = records.map((r) => r.lastActiveMs);
        expect([...ages].sort((a, b) => b - a)).toEqual(ages);
    });

    it("covers all four agents plus an unknown one for the icon fallback", () => {
        const agents = new Set(records.map((r) => r.meta.agent));
        expect(agents).toContain("claude");
        expect(agents).toContain("codex");
        expect(agents).toContain("grok");
        expect(agents).toContain("antigravity");
        const unknown = records.find((r) => r.meta.agent === "hermes")!;
        expect(buildSessionRow(unknown, NOW).iconId).toBe("circle-outline");
    });

    it("covers every summary source and both turn statuses", () => {
        const turns = records.flatMap((r) => r.turns);
        expect(new Set(turns.map((t) => t.source))).toEqual(
            new Set(["llm", "heuristic", "native"])
        );
        expect(turns.some((t) => t.status === "error")).toBe(true);
        expect(
            turns.flatMap((t) => t.tools ?? []).some((x) => x.status === "error")
        ).toBe(true);
    });

    it("spans the relative-age formats a real store would show", () => {
        const descriptions = records.map(
            (r) => buildSessionRow(r, NOW).description
        );
        expect(descriptions.some((d) => d.includes("m ago"))).toBe(true);
        expect(descriptions.some((d) => d.includes("h ago"))).toBe(true);
        expect(descriptions.some((d) => d.includes("yesterday"))).toBe(true);
        expect(descriptions.some((d) => d.includes("d ago"))).toBe(true);
    });

    it("includes a zero-turn session that renders the empty branch", () => {
        const empty = byId.get("sample-codex-emptystart")!;
        expect(empty.turns).toHaveLength(0);
        expect(buildSessionRow(empty, NOW).description).toContain("0 turns");
        expect(md("sample-codex-emptystart")).toContain("尚無 turn 記錄");
    });

    it("includes a torn-tail session that surfaces the malformed warning", () => {
        const torn = byId.get("sample-claude-torntail")!;
        expect(torn.malformedLines).toBe(1);
        expect(torn.turns).toHaveLength(1); // the complete turn survives
        expect(md("sample-claude-torntail")).toContain("無法解析");
        expect(buildSessionRow(torn, NOW).tooltip).toContain("malformed");
    });

    it("omits the resume block for an agent with no CLI resume", () => {
        expect(byId.get("sample-antigravity-0b9f4a12")!.meta.resume).toBeUndefined();
        expect(md("sample-antigravity-0b9f4a12")).not.toContain("## Resume");
        expect(md("sample-claude-70471642")).toContain("## Resume");
    });

    it("clips a long round heading but keeps the full prompt in the body", () => {
        const doc = md("sample-claude-1f9d0e33");
        const heading = doc
            .split("\n")
            .find((l) => l.startsWith("## Round 1"))!;
        expect(heading).toContain("…");
        expect(heading.length).toBeLessThan(90);
        expect(doc).toContain("不要另外開 tooltip 才看得到");
    });

    it("clamps an over-long tool result", () => {
        expect(md("sample-claude-1f9d0e33")).toContain("… (truncated)");
    });

    it("renders a multi-line prompt as a quote block", () => {
        expect(md("sample-claude-1f9d0e33")).toContain("> 1. H1 給整個 session");
    });

    it("documents what each sample covers", () => {
        expect(sampleCoverage()).toHaveLength(records.length);
        for (const line of sampleCoverage()) {
            expect(line).toMatch(/^sample-.+: .+/);
        }
    });
});

describe("sample data", () => {
    it("emits JSONL the parser accepts, with tool records", () => {
        const spec = {
            id: "sample-x",
            agent: "claude",
            title: "t",
            ageMinutes: 10,
            resumeCommand: (id: string) => `claude --resume ${id}`,
            turns: [
                {
                    user: "u",
                    summary: "s",
                    source: "llm",
                    tools: [{ name: "Read", result: "r" }],
                },
            ],
        };
        const text = renderSampleJsonl(spec, "/w", 1_700_000_000_000);
        const rec = parseSessionJsonl(text, "/w/sample-x.jsonl", text.length, 0);
        expect(rec.malformedLines).toBe(0);
        expect(rec.meta.session_id).toBe("sample-x");
        expect(rec.turns[0].tools?.[0].name).toBe("Read");
    });
});

describe("session document URI", () => {
    // The exact case that broke the panel: the backing file lives under a
    // workspace segment whose `/` are encoded as `%2F`, so any path-based
    // encoding round-trips back to `/` and the doc provider can't find it.
    const REAL_FILE =
        "/Users/shuk/.config/superset/data/sessions/%2FUsers%2Fshuk%2Fprojects%2Ftmp%2Fsuperset/sample-claude-70471642.jsonl";

    it("round-trips a real store path through the URI without mangling", () => {
        const uri = sessionDocUri(REAL_FILE);
        expect(uri.scheme).toBe(SESSION_DOC_SCHEME);
        // path is now deterministic (just the session id), so the parser can
        // never go wrong on it — the real file path rides in `query`.
        expect(uri.path).toBe("/sample-claude-70471642.md");
        expect(uri.query).toBe(REAL_FILE);
        expect(sessionPathFromDocUri(uri)).toBe(REAL_FILE);
    });

    it("refuses to claim a non-session URI", () => {
        const stranger = foreignUri("file", "/tmp/x.md");
        expect(sessionPathFromDocUri(stranger)).toBeUndefined();
    });

    it("rejects a doc URI whose query is missing or not absolute", () => {
        expect(
            sessionPathFromDocUri(foreignUri(SESSION_DOC_SCHEME, "/x.md"))
        ).toBeUndefined();
        expect(
            sessionPathFromDocUri(
                foreignUri(SESSION_DOC_SCHEME, "/x.md", "x.md")
            )
        ).toBeUndefined();
    });
});
