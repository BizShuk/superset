// Pure row rendering for the Sessions panel. No `vscode` import — the
// provider turns these plain specs into `TreeItem`s, tests assert on the
// spec directly.

import { formatAge, formatBytes, formatStamp } from "./markdown";
import type { SessionSummary } from "./types";

export interface SessionRowSpec {
    readonly label: string;
    /** Dim trailing text: size + turn count + age (per the panel spec). */
    readonly description: string;
    readonly tooltip: string;
    readonly iconId: string;
}

const AGENT_ICONS: Record<string, string> = {
    claude: "sparkle",
    codex: "robot",
    grok: "zap",
    antigravity: "rocket",
};

export function buildSessionRow(
    record: SessionSummary,
    nowMs: number
): SessionRowSpec {
    const { meta, turnCount } = record;
    const turnLabel = `${turnCount} turn${turnCount === 1 ? "" : "s"}`;

    return {
        label: meta.title || meta.session_id,
        description: `${formatBytes(record.sizeBytes)} · ${turnLabel} · ${formatAge(
            record.lastActiveMs,
            nowMs
        )}`,
        tooltip: [
            `${meta.agent} · ${meta.session_id}`,
            meta.workspace_path,
            `started ${formatStamp(meta.created_at)}`,
            `last active ${formatStamp(new Date(record.lastActiveMs).toISOString())}`,
            record.malformedLines > 0
                ? `⚠️ ${record.malformedLines} malformed line(s)`
                : "",
        ]
            .filter(Boolean)
            .join("\n"),
        iconId: AGENT_ICONS[meta.agent] ?? "circle-outline",
    };
}
