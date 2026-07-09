// Open Settings + Show Diagnostics — two pure renderers that produce
// temporary Markdown documents the caller opens via
// openTextDocument + markdown.showPreview. Pure module, no vscode
// import — testable in isolation.
//
// The extension has zero `contributes.configuration` entries today,
// so the "Open Settings" view lists every `superset.*` registered
// command with its category, icon, and title — giving the user a
// single searchable surface for "what can superset do?".

import type { ExtensionManifest } from "./diagnosticsPanel.types";

/** Render the settings overview as Markdown. */
export function renderSettingsMarkdown(manifest: ExtensionManifest): string {
    const cmds = manifest.contributes?.commands ?? [];
    const groups: Record<string, typeof cmds> = {};
    for (const cmd of cmds) {
        const group = groupFromCommandId(cmd.command);
        if (!groups[group]) groups[group] = [];
        groups[group].push(cmd);
    }

    let md = `# Superset Settings & Commands\n\n`;
    md += `Surfaces every \`superset.*\` command the extension registers. `;
    md += `Use the Command Palette (\`Ctrl+Shift+P\`) to invoke any entry below.\n\n`;
    md += `${cmds.length} commands across ${Object.keys(groups).length} categories.\n\n`;

    const sortedGroups = Object.entries(groups).sort(([a], [b]) =>
        a.localeCompare(b)
    );
    for (const [group, entries] of sortedGroups) {
        md += `## ${group} (${entries.length})\n\n`;
        md += `| Command | Title | Icon |\n| --- | --- | --- |\n`;
        for (const cmd of entries) {
            md +=
                `| \`${cmd.command}\` ` +
                `| ${cmd.title.replace(/\|/g, "\\|")} ` +
                `| ${cmd.icon ? `\`${cmd.icon}\`` : "—"} |\n`;
        }
        md += `\n`;
    }
    return md;
}

/** Heuristic grouping by command prefix. `superset.todoFilterP0`
 *  → "todo" since the prefix-before-the-first-camel-case-suffix is
 *  the namespace. Falls back to "general" for unrecognised prefixes. */
function groupFromCommandId(id: string): string {
    if (!id.startsWith("superset.")) return "general";
    const rest = id.slice("superset.".length);
    // Common prefixes: todo, projectsTodo, mdns, topology, terminals,
    // revealInTree, openProject, showLogs, focusView, etc.
    if (rest.startsWith("projectsTodo")) return "Projects TODO";
    const m = rest.match(/^([a-z]+)/);
    const prefix = m?.[1] ?? "general";
    return (
        {
            todo: "TODO",
            mdns: "mDNS",
            topology: "Topology",
            terminals: "Terminals",
            open: "Projects",
            openTui: "Terminals",
            newTerminal: "Terminals",
            delete: "Terminals",
            rename: "Terminals",
            copyName: "Terminals",
            jumpToTerminal: "Terminals",
            focus: "Chrome",
            focusView: "Chrome",
            focusPanel: "Chrome",
            focusOverallView: "Chrome",
            resetCaches: "Chrome",
            show: "Chrome",
            revealInTree: "Chrome",
            installDefaultTools: "Install",
            skillInstall: "Install",
            installIgnoreTemplate: "Install",
            openProject: "Projects",
            projectsTodo: "Projects TODO",
            terminalActivitySummary: "Terminals",
        } as Record<string, string>
    )[prefix] ?? prefix;
}

/** Render the diagnostics snapshot as Markdown. Pure renderer —
 *  caller passes in the snapshot data. */
export interface DiagnosticsSnapshot {
    capturedAt: Date;
    terminalCount: number;
    unseenTerminalCount: number;
    mDNSServiceCount: number;
    todoItemCount: number;
    projectsTodoProjectCount: number;
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
    md += `| Tracked terminals | ${snapshot.terminalCount} |\n`;
    md += `| Terminals with unseen output | ${snapshot.unseenTerminalCount} |\n`;
    md += `| mDNS services | ${snapshot.mDNSServiceCount} |\n`;
    md += `| TODO items (active workspace) | ${snapshot.todoItemCount} |\n`;
    md += `| Projects (with README.todo) | ${snapshot.projectsTodoProjectCount} |\n`;

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