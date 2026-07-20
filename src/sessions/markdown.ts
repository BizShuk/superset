// Pure JSONL → Markdown renderer for the session summary document.
//
// Heading contract (fixed — the editor view is read as a document, so the
// outline must be stable):
//   `#`   whole session title
//   `##`  one round (turn)
//   `###` one tool execution + its result inside that round
//
// No `vscode` import: this is a string function covered by vitest.

import type { SessionRecord, SessionToolCall, SessionTurn } from "./types";

const MAX_TOOL_BLOCK_CHARS = 1_200;

export function renderSessionMarkdown(record: SessionRecord): string {
    const out: string[] = [];
    const { meta, turns } = record;

    out.push(`# ${meta.title || meta.session_id}`);
    out.push("");
    out.push(renderMetaTable(record));
    out.push("");

    if (turns.length === 0) {
        out.push("> 尚無 turn 記錄 (no turns recorded yet)。");
        out.push("");
    }

    for (const turn of turns) {
        out.push(...renderTurn(turn));
    }

    if (record.malformedLines > 0) {
        out.push("---");
        out.push("");
        out.push(
            `> ⚠️ ${record.malformedLines} 行無法解析 (malformed lines skipped)。`
        );
        out.push("");
    }

    if (meta.resume?.command) {
        out.push("---");
        out.push("");
        out.push("## Resume");
        out.push("");
        out.push("```bash");
        out.push(`cd ${meta.resume.cwd || meta.workspace_path}`);
        out.push(meta.resume.command);
        out.push("```");
        out.push("");
    }

    return out.join("\n");
}

function renderMetaTable(record: SessionRecord): string {
    const { meta, turns } = record;
    const rows: [string, string][] = [
        ["agent", `\`${meta.agent}\``],
        ["session", `\`${meta.session_id}\``],
        ["workspace", `\`${meta.workspace_path}\``],
        ["turns", String(turns.length)],
        ["started", formatStamp(meta.created_at)],
        ["size", formatBytes(record.sizeBytes)],
    ];
    return [
        "| | |",
        "| --- | --- |",
        ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    ].join("\n");
}

function renderTurn(turn: SessionTurn): string[] {
    const out: string[] = [];
    // The round heading is the *ask* (clipped), not the summary — the summary
    // is the body text right below, and repeating it reads as a stutter in the
    // outline.
    const headline = clipHeadline(turn.user || turn.summary || `turn ${turn.index}`);
    const flag = turn.status === "error" ? " ❌" : "";

    out.push(`## Round ${turn.index} — ${headline}${flag}`);
    out.push("");
    out.push(
        `\`${formatStamp(turn.at)}\` · \`${turn.event}\` · summary source \`${turn.source}\``
    );
    out.push("");

    if (turn.user) {
        out.push("Prompt:");
        out.push("");
        out.push(quote(turn.user));
        out.push("");
    }
    if (turn.summary) {
        out.push(turn.summary);
        out.push("");
    }

    for (const tool of turn.tools ?? []) {
        out.push(...renderTool(tool));
    }

    return out;
}

function renderTool(tool: SessionToolCall): string[] {
    const out: string[] = [];
    const mark = tool.status === "error" ? "❌" : "🔧";
    const took =
        typeof tool.duration_ms === "number" ? ` · ${tool.duration_ms}ms` : "";

    out.push(`### ${mark} ${tool.name}${took}`);
    out.push("");
    if (tool.input) {
        out.push("```sh");
        out.push(clamp(tool.input));
        out.push("```");
        out.push("");
    }
    if (tool.result) {
        out.push("```text");
        out.push(clamp(tool.result));
        out.push("```");
        out.push("");
    }
    return out;
}

function quote(text: string): string {
    return text
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
}

function clipHeadline(text: string): string {
    const line = text.split("\n")[0].trim();
    return line.length <= MAX_HEADLINE_CHARS
        ? line
        : `${line.slice(0, MAX_HEADLINE_CHARS)}…`;
}

const MAX_HEADLINE_CHARS = 60;

function clamp(text: string): string {
    if (text.length <= MAX_TOOL_BLOCK_CHARS) return text;
    return `${text.slice(0, MAX_TOOL_BLOCK_CHARS)}\n… (truncated)`;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatStamp(iso: string): string {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return iso || "—";
    return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

/** "2h ago" style relative age, used by both the tree row and tooltips. */
export function formatAge(fromMs: number, nowMs: number): string {
    const diff = Math.max(0, nowMs - fromMs);
    const min = Math.floor(diff / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return day === 1 ? "yesterday" : `${day}d ago`;
}
