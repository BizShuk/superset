// Pure diagnostics renderer. The caller captures live runtime state and
// opens the resulting Markdown in VS Code preview.

export interface DiagnosticsSnapshot {
    capturedAt: Date;
    terminalCount?: number;
    unseenTerminalCount?: number;
    mDNSServiceCount?: number;
    todoItemCount?: number;
    activePluginIds: string[];
}

export function renderDiagnosticsMarkdown(
    snapshot: DiagnosticsSnapshot
): string {
    const ts = snapshot.capturedAt.toISOString().replace("T", " ").slice(0, 19);

    let md = `# Superset Diagnostics\n\n`;
    md += `Captured at \`${ts}\`. One-shot snapshot of every subsystem.\n\n`;

    md += `## Counts\n\n`;
    md += `| Subsystem | Count |\n| --- | --- |\n`;
    md += `| Tracked terminals | ${formatCount(snapshot.terminalCount)} |\n`;
    md += `| Terminals with unseen output | ${formatCount(snapshot.unseenTerminalCount)} |\n`;
    md += `| mDNS services | ${formatCount(snapshot.mDNSServiceCount)} |\n`;
    md += `| TODO tasks (active workspace) | ${formatCount(snapshot.todoItemCount)} |\n`;

    md += `\n## Active plugins\n\n`;
    if (snapshot.activePluginIds.length === 0) {
        md += `_No plugins currently active._\n`;
    } else {
        for (const id of snapshot.activePluginIds) {
            md += `- ${id}\n`;
        }
    }

    md += `\n## How to use\n\n`;
    md += `- **Copy / Save**: click the toolbar icons in the markdown preview.\n`;
    md += `- **Live tail**: \`Superset: Show Diagnostic Logs\` for the running log stream.\n`;
    md += `- **Reset state**: \`Superset: Reset Caches\` to wipe the workspace state.\n`;
    return md;
}

function formatCount(count: number | undefined): number | "Unavailable" {
    return count ?? "Unavailable";
}
