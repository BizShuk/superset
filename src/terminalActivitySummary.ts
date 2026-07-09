// Terminal Activity Summary — captures a snapshot of every tracked
// terminal's metadata (name, process id, creation options, unseen
// status) and renders it as a temporary Markdown document the user
// can read / scroll / copy. Aiming to close the gap where the panel
// only gives a boolean "unseen" indicator; this is a fuller view.
//
// Pure module — no `vscode` import. The caller (`globalCommands` or
// a dedicated command in `terminals/index.ts`) handles the
// `workspace.openTextDocument` + `showPreview` dance.

import type { TerminalRegistry } from "./terminals/terminalRegistry";

/** One row in the activity summary — pulled from the `TerminalRegistry`
 *  state plus the `vscode.Terminal` properties exposed via
 *  `TerminalHandle` (declared in `src/terminals/types.ts`). */
export interface TerminalActivityRow {
    name: string;
    processId?: number;
    cwd?: string;
    hiddenFromUser: boolean;
    isPtyBacked: boolean;
    hasUnseen: boolean;
}

/** Snapshot of the registry — pulled in batch to avoid the caller
 *  walking the registry twice. */
export function captureSnapshot(
    registry: TerminalRegistry
): TerminalActivityRow[] {
    const rows: TerminalActivityRow[] = [];
    for (const entry of registry.getAll()) {
        const t = entry.terminal as unknown as {
            name: string;
            processId?: number | Promise<number | undefined>;
            creationOptions?: { cwd?: string | { fsPath?: string }; hideFromUser?: boolean; pty?: unknown };
        };
        // `processId` is sometimes a Promise<number | undefined> —
        // we only take the synchronous-number fallback.
        let pid: number | undefined;
        if (typeof t.processId === "number") {
            pid = t.processId;
        }
        const opts = t.creationOptions ?? {};
        const cwd =
            typeof opts.cwd === "string"
                ? opts.cwd
                : opts.cwd && typeof opts.cwd === "object" && "fsPath" in opts.cwd
                ? (opts.cwd as { fsPath: string }).fsPath
                : undefined;
        rows.push({
            name: t.name,
            processId: pid,
            cwd,
            hiddenFromUser: Boolean(opts.hideFromUser),
            isPtyBacked: Boolean(opts.pty),
            hasUnseen: Boolean(entry.hasUnseenOutput),
        });
    }
    return rows;
}

/** Render the snapshot as a Markdown document with a summary table
 *  plus per-terminal sections. Pinned last-update timestamp comes
 *  from the caller (the registry doesn't carry one). */
export function renderActivityMarkdown(
    rows: readonly TerminalActivityRow[],
    capturedAt: Date
): string {
    const ts = capturedAt.toISOString().replace("T", " ").slice(0, 19);
    const unseenCount = rows.filter((r) => r.hasUnseen).length;
    const ptyCount = rows.filter((r) => r.isPtyBacked).length;

    let md =
        `# Terminal Activity Summary\n\n` +
        `Captured at \`${ts}\`. ${rows.length} terminal(s) tracked; ` +
        `**${unseenCount}** with unseen output; **${ptyCount}** PTY-backed.\n\n`;

    if (rows.length === 0) {
        md += "_No terminals currently tracked._\n";
        return md;
    }

    md += `| Name | PID | cwd | Hidden | PTY | Unseen |\n`;
    md += `| --- | --- | --- | --- | --- | --- |\n`;
    for (const r of rows) {
        md +=
            `| \`${r.name.replace(/\|/g, "\\|")}\` ` +
            `| ${r.processId ?? "—"} ` +
            `| ${r.cwd ? `\`${r.cwd}\`` : "—"} ` +
            `| ${r.hiddenFromUser ? "yes" : "no"} ` +
            `| ${r.isPtyBacked ? "yes" : "no"} ` +
            `| ${r.hasUnseen ? "**yes**" : "no"} |\n`;
    }

    md += `\n## Per-terminal details\n\n`;
    for (const r of rows) {
        md += `### \`${r.name}\`\n\n`;
        if (r.cwd) md += `- cwd: \`${r.cwd}\`\n`;
        if (r.processId) md += `- pid: ${r.processId}\n`;
        md += `- hiddenFromUser: ${r.hiddenFromUser ? "yes" : "no"}\n`;
        md += `- pty: ${r.isPtyBacked ? "yes" : "no"}\n`;
        md += `- unseen: ${r.hasUnseen ? "yes" : "no"}\n`;
        md += `\n`;
    }
    return md;
}