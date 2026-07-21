// Sample session generator.
//
// The `sessiond` LLM summary path (plan §4 Phase 4, gemma) is not verified
// yet, so the panel would render an empty tree on most machines. This
// module writes schema-valid fake sessions into the real store location so
// the feature can be exercised end-to-end before the ingestor lands.
//
// The set below is deliberately a FIXTURE MATRIX, not a demo: between them
// the sessions hit every branch the tree and the markdown renderer have —
// see SAMPLES for the per-entry `covers` note. Adding a rendering branch
// without a sample that reaches it is how this file goes stale.
//
// It writes ONLY files named `sample-*.jsonl`, and the cleanup path removes
// only that prefix — real ingested sessions are never touched.

import * as fs from "fs";
import * as path from "path";
import { workspaceSessionsDir } from "./store";
import type { SessionMeta, SessionTurn } from "./types";

export const SAMPLE_PREFIX = "sample-";

/** Minutes between consecutive turns in generated sessions. */
const TURN_SPACING_MIN = 4;

export interface SampleSpec {
    readonly id: string;
    readonly agent: string;
    readonly title: string;
    /** Age of the LAST turn, so the row's relative time is exact. */
    readonly ageMinutes: number;
    /** Which rendering branches this entry exists to cover. */
    readonly covers: string;
    /** Omitted for agents with no CLI resume (Antigravity) — the markdown
     *  then renders without a resume block. */
    readonly resumeCommand?: (id: string) => string;
    readonly turns: readonly SampleTurn[];
    /** Raw junk appended after the last line, to exercise the torn-tail /
     *  malformed-line counter the ingestor's concurrent appends can cause. */
    readonly malformedTail?: string;
}

export interface SampleTurn {
    readonly user: string;
    readonly summary: string;
    readonly source: string; // heuristic | llm | native
    readonly status?: string; // ok | error
    readonly event?: string; // Stop | StopFailure | SubagentStop | TaskCompleted
    readonly tools?: readonly {
        name: string;
        input?: string;
        result?: string;
        status?: string;
        duration_ms?: number;
    }[];
}

/** A >1200-char tool result, so the markdown renderer's clamp path fires. */
const LONG_TEST_LOG = Array.from(
    { length: 40 },
    (_, i) =>
        `ok  \tgithub.com/bizshuk/sessiond/internal/pkg${String(i).padStart(
            2,
            "0"
        )}\t0.0${(i % 9) + 1}2s\tcoverage: ${60 + (i % 40)}.${i % 10}% of statements`
).join("\n");

const SAMPLES: readonly SampleSpec[] = [
    {
        id: `${SAMPLE_PREFIX}claude-70471642`,
        agent: "claude",
        title: "探查四個 agent session 格式",
        ageMinutes: 95,
        covers: "claude icon · llm source · multi-tool H3 · hours-ago row",
        resumeCommand: (id) => `claude --resume ${id}`,
        turns: [
            {
                user: "讀 CLAUDE.md 與專案結構,告訴我 plugin 是怎麼註冊的",
                summary:
                    "讀專案說明並盤點 src/ 結構,確認 extension.ts 是 declarative composition root,plugin 依序 activate。",
                source: "llm",
                tools: [
                    {
                        name: "Read",
                        input: "CLAUDE.md",
                        result: "# Superset 專案說明\n… 12 個 module,panelLayoutPlugin 必須最後啟用",
                        status: "ok",
                        duration_ms: 34,
                    },
                    {
                        name: "Bash",
                        input: "ls src/",
                        result: "extension.ts\nmdns/\nterminals/\ntodo/\ntopology/\n…",
                        status: "ok",
                        duration_ms: 61,
                    },
                ],
            },
            {
                user: "四家 agent 的 session 檔案分別放在哪?格式是什麼?",
                summary:
                    "盤點 Claude / Codex / Grok / Antigravity 的 session 落點,前三家是 JSONL,Antigravity 是 SQLite + protobuf blob。",
                source: "llm",
                tools: [
                    {
                        name: "Bash",
                        input: "ls ~/.claude/projects | head -5",
                        result: "-Users-shuk-projects-tmp-superset\n-Users-shuk-projects-stock\n…",
                        status: "ok",
                        duration_ms: 22,
                    },
                    {
                        name: "Bash",
                        input: "ls ~/.codex/sessions/2026/07/20 | head -3",
                        result: "rollout-2026-07-20T10-31-59-70471642.jsonl\n…",
                        status: "ok",
                        duration_ms: 18,
                    },
                    {
                        name: "Grep",
                        input: "session_meta ~/.codex/sessions/2026/07/20/*.jsonl",
                        result: '{"payload":{"cwd":"/Users/shuk/projects/tmp/superset"}}',
                        status: "ok",
                        duration_ms: 140,
                    },
                ],
            },
            {
                user: "把 store schema 凍結,兩邊各自開發",
                summary:
                    "定義 meta + turn 的 append-only JSONL 契約,schemaVersion=1,Go 只寫、extension 只讀。",
                source: "llm",
                tools: [
                    {
                        name: "Write",
                        input: "sessiond/internal/model/session.go",
                        result: "wrote 48 lines",
                        status: "ok",
                        duration_ms: 12,
                    },
                ],
            },
            {
                user: "跑一下測試",
                summary: "go test ./... 全綠,ingest 與 store 各 6 個 case 通過。",
                source: "llm",
                event: "TaskCompleted",
                tools: [
                    {
                        name: "Bash",
                        input: "go test ./...",
                        result: "ok  github.com/bizshuk/sessiond/internal/ingest  0.212s\nok  github.com/bizshuk/sessiond/internal/store   0.104s",
                        status: "ok",
                        duration_ms: 2_140,
                    },
                ],
            },
        ],
    },
    {
        id: `${SAMPLE_PREFIX}codex-8c21ab55`,
        agent: "codex",
        title: "surfboard adapter 重構",
        ageMinutes: 1_500,
        covers: "codex icon · heuristic source · error turn (❌) · failing tool · yesterday row",
        resumeCommand: (id) => `codex resume ${id}`,
        turns: [
            {
                user: "把 adapter 的 config 讀取抽出來",
                summary:
                    "將散在三個檔案的 config 讀取收斂成單一 loader,移除重複的 env fallback。",
                source: "heuristic",
                tools: [
                    {
                        name: "Edit",
                        input: "internal/adapter/config.go",
                        result: "+42 -18",
                        status: "ok",
                        duration_ms: 9,
                    },
                ],
            },
            {
                user: "test 沒過,看一下",
                summary: "loader 少處理空字串 fallback,補上後測試通過。",
                source: "heuristic",
                status: "error",
                event: "StopFailure",
                tools: [
                    {
                        name: "Bash",
                        input: "go test ./internal/adapter",
                        result: '--- FAIL: TestLoadDefaults (0.00s)\n    config_test.go:31: want "~/.config/surf", got ""\nFAIL',
                        status: "error",
                        duration_ms: 890,
                    },
                    {
                        name: "Bash",
                        input: "go test ./internal/adapter",
                        result: "ok  github.com/bizshuk/surf/internal/adapter  0.031s",
                        status: "ok",
                        duration_ms: 640,
                    },
                ],
            },
        ],
    },
    {
        id: `${SAMPLE_PREFIX}grok-3d5e71c0`,
        agent: "grok",
        title: "評估 sessiond 摘要 provider 成本",
        ageMinutes: 3 * 24 * 60,
        covers: "grok icon · native source (agent 自帶 summary) · days-ago row",
        resumeCommand: (id) => `grok --resume ${id}`,
        turns: [
            {
                user: "gemma 跟 ollama 本地跑,一天 200 個 turn 成本差多少?",
                summary:
                    "估算 200 turn/day × 64 max tokens:Google API 每月約 $0.4,本地 ollama 為零,但冷啟動延遲 +1.2s。",
                source: "native",
            },
            {
                user: "那預設走哪個?",
                summary:
                    "預設 google + 無 key 自動降級 heuristic;完全離線情境才切 ollama。",
                source: "native",
            },
        ],
    },
    {
        id: `${SAMPLE_PREFIX}antigravity-0b9f4a12`,
        agent: "antigravity",
        title: "protobuf steps blob 逆向嘗試",
        ageMinutes: 5 * 24 * 60,
        covers: "antigravity icon · NO resume block (無 CLI resume) · tool with input only",
        turns: [
            {
                user: "conversations/<uuid>.db 的 steps 能不能直接讀?",
                summary:
                    "step_payload 是 protobuf blob,無 .proto 只能 heuristic 抽字串;結論是只列出 session 與 turn 數,不做摘要。",
                source: "heuristic",
                tools: [
                    {
                        name: "Bash",
                        input: "sqlite3 ~/.gemini/antigravity/conversations/0b9f4a12.db '.schema steps'",
                        result: "CREATE TABLE steps (id INTEGER PRIMARY KEY, step_payload BLOB, …);",
                        status: "ok",
                        duration_ms: 47,
                    },
                    {
                        name: "Read",
                        input: "trajectory_meta (blob preview)",
                        status: "error",
                        duration_ms: 5,
                    },
                ],
            },
        ],
    },
    {
        id: `${SAMPLE_PREFIX}hermes-5c2201ff`,
        agent: "hermes",
        title: "未知 agent:圖示 fallback 驗證",
        ageMinutes: 30,
        covers: "unknown agent → circle-outline icon fallback · minutes-ago row",
        resumeCommand: (id) => `hermes resume ${id}`,
        turns: [
            {
                user: "這個 agent 還沒進 AGENT_ICONS,面板會怎麼顯示?",
                summary: "落到 circle-outline,其餘欄位照常渲染,不會讓整列消失。",
                source: "heuristic",
            },
        ],
    },
    {
        id: `${SAMPLE_PREFIX}claude-1f9d0e33`,
        agent: "claude",
        title: "Sessions 面板 row 與 markdown 版面對齊",
        ageMinutes: 8,
        covers: "long headline clipping · multi-line prompt quote · clamped (>1.2k) tool output · largest file",
        resumeCommand: (id) => `claude --resume ${id}`,
        turns: [
            {
                user: "session row 的 dim description 要顯示什麼?我想要同時看到檔案大小、turn 數量,還有最後一次活動距離現在多久,不要另外開 tooltip 才看得到",
                summary:
                    "決定 dim description = 檔案大小 · turn 數 · 相對時間,tooltip 只放 workspace 與 session id。",
                source: "llm",
            },
            {
                user: "markdown 的 heading 階層定義一下:\n1. H1 給整個 session\n2. H2 給每個 round\n3. H3 給 tool 執行與結果\n然後長輸出要截斷,不要讓一次 build log 洗掉整份文件",
                summary:
                    "凍結 heading 契約並在 renderer 內對 tool 區塊做 1200 字截斷,超出補「… (truncated)」。",
                source: "llm",
                tools: [
                    {
                        name: "Bash",
                        input: "go test ./... -cover",
                        result: LONG_TEST_LOG,
                        status: "ok",
                        duration_ms: 12_480,
                    },
                ],
            },
            {
                user: "sample 資料補齊所有分支",
                summary:
                    "把 sample 從 3 筆擴成矩陣:四家 agent + 未知 agent、error turn、無 resume、空 session、malformed 尾行。",
                source: "llm",
                event: "SubagentStop",
                tools: [
                    {
                        name: "Write",
                        input: "src/sessions/sampleData.ts",
                        result: "+180 -40",
                        status: "ok",
                        duration_ms: 15,
                    },
                ],
            },
        ],
    },
    {
        id: `${SAMPLE_PREFIX}codex-emptystart`,
        agent: "codex",
        title: "剛開場、尚未產生 turn 的 session",
        ageMinutes: 1,
        covers: "zero turns → '尚無 turn 記錄' markdown branch · '0 turns' row · just-now age",
        resumeCommand: (id) => `codex resume ${id}`,
        turns: [],
    },
    {
        id: `${SAMPLE_PREFIX}claude-torntail`,
        agent: "claude",
        title: "寫入中被讀取的 session(尾行未完整)",
        ageMinutes: 12,
        covers: "malformed tail → ⚠️ markdown banner + tooltip warning",
        resumeCommand: (id) => `claude --resume ${id}`,
        turns: [
            {
                user: "hook 正在 append 時面板剛好 refresh 會怎樣?",
                summary:
                    "最後一行可能只寫到一半;parser 記為 malformed 並保留已完成的 turn,不整檔失敗。",
                source: "llm",
                tools: [
                    {
                        name: "Read",
                        input: "sample-claude-torntail.jsonl",
                        result: "2 lines ok, 1 line truncated",
                        status: "ok",
                        duration_ms: 3,
                    },
                ],
            },
        ],
        malformedTail: '{"type":"turn","index":2,"user":"下一個 turn 寫到一半',
    },
];

/** What each sample is here to prove. Surfaced by the seed command's log. */
export function sampleCoverage(): string[] {
    return SAMPLES.map((s) => `${s.id}: ${s.covers}`);
}

/**
 * Write the sample sessions for `workspacePath`. Returns the created file
 * paths. Existing sample files are overwritten so re-running is idempotent.
 */
export function writeSampleSessions(
    workspacePath: string,
    nowMs: number,
    override?: string
): string[] {
    const dir = workspaceSessionsDir(workspacePath, override);
    fs.mkdirSync(dir, { recursive: true });

    const written: string[] = [];
    for (const spec of SAMPLES) {
        const filePath = path.join(dir, `${spec.id}.jsonl`);
        fs.writeFileSync(
            filePath,
            renderSampleJsonl(spec, workspacePath, nowMs),
            "utf8"
        );
        // Backdate mtime to the session's own age so a zero-turn sample (which
        // has no turn timestamp to fall back from) still reads as its designed
        // age instead of "just now".
        const agedAt = new Date(nowMs - spec.ageMinutes * 60_000);
        try {
            fs.utimesSync(filePath, agedAt, agedAt);
        } catch {
            /* mtime is cosmetic here — a failure just shows the seed time */
        }
        written.push(filePath);
    }
    return written;
}

/**
 * Clear stale sample files, then write the current fixture matrix.
 * Non-sample sessions are deliberately preserved.
 */
export function seedSampleSessions(
    workspacePath: string,
    nowMs: number,
    override?: string
): string[] {
    clearSampleSessions(workspacePath, override);
    return writeSampleSessions(workspacePath, nowMs, override);
}

/** Delete every `sample-*.jsonl` in this workspace's session dir. */
export function clearSampleSessions(
    workspacePath: string,
    override?: string
): number {
    const dir = workspaceSessionsDir(workspacePath, override);
    let removed = 0;
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return 0;
    }
    for (const name of entries) {
        if (!name.startsWith(SAMPLE_PREFIX) || !name.endsWith(".jsonl")) continue;
        try {
            fs.rmSync(path.join(dir, name), { force: true });
            removed++;
        } catch {
            /* leave it; the panel just keeps showing it */
        }
    }
    return removed;
}

/**
 * Pure: spec → JSONL text. Exposed for tests.
 *
 * Turns are laid out BACKWARDS from `ageMinutes` so the last turn lands
 * exactly at that age — otherwise a short session's timestamps would run
 * past `nowMs` and every row would collapse to "just now".
 */
export function renderSampleJsonl(
    spec: SampleSpec,
    workspacePath: string,
    nowMs: number
): string {
    const spacingMs = TURN_SPACING_MIN * 60_000;
    const lastMs = nowMs - spec.ageMinutes * 60_000;
    const turnAt = (i: number) =>
        lastMs - (spec.turns.length - 1 - i) * spacingMs;
    const createdMs =
        spec.turns.length > 0 ? turnAt(0) - spacingMs : lastMs;

    const meta: SessionMeta = {
        type: "meta",
        agent: spec.agent,
        session_id: spec.id,
        workspace_path: workspacePath,
        title: spec.title,
        ...(spec.resumeCommand
            ? {
                  resume: {
                      kind: "terminal",
                      command: spec.resumeCommand(spec.id),
                      cwd: workspacePath,
                  },
              }
            : {}),
        created_at: new Date(createdMs).toISOString(),
        schema_version: 1,
    };

    const lines = [JSON.stringify(meta)];
    spec.turns.forEach((t, i) => {
        const turn: SessionTurn = {
            type: "turn",
            index: i + 1,
            event: t.event ?? "Stop",
            user: t.user,
            summary: t.summary,
            source: t.source,
            status: t.status ?? "ok",
            at: new Date(turnAt(i)).toISOString(),
            tools: t.tools,
        };
        lines.push(JSON.stringify(turn));
    });
    if (spec.malformedTail) {
        lines.push(spec.malformedTail);
    }

    return `${lines.join("\n")}\n`;
}
