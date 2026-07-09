// Tests for the pure renderers in src/diagnosticsPanel. No
// `vscode` dependency — runs in vitest without any mock.

import { describe, expect, it } from "vitest";
import {
    renderSettingsMarkdown,
    renderDiagnosticsMarkdown,
    type DiagnosticsSnapshot,
} from "../src/diagnosticsPanel";
import type { ExtensionManifest } from "../src/diagnosticsPanel.types";

const sampleManifest: ExtensionManifest = {
    contributes: {
        commands: [
            { command: "superset.todoToggle", title: "Toggle Todo" },
            { command: "superset.mdnsRefresh", title: "Refresh mDNS" },
            { command: "superset.showLogs", title: "Show Diagnostic Logs" },
            { command: "superset.openProject", title: "Open Project" },
        ],
    },
};

describe("renderSettingsMarkdown", () => {
    it("groups commands by prefix", () => {
        const md = renderSettingsMarkdown(sampleManifest);
        expect(md).toContain("# Superset Settings & Commands");
        expect(md).toContain("4 commands across");
        expect(md).toContain("## TODO");
        expect(md).toContain("## mDNS");
        expect(md).toContain("## Chrome");
        expect(md).toContain("## Projects");
        expect(md).toContain("`superset.todoToggle`");
    });

    it("escapes pipe characters in command titles", () => {
        const md = renderSettingsMarkdown({
            contributes: {
                commands: [
                    { command: "superset.foo", title: "Title with | pipe" },
                ],
            },
        });
        expect(md).toContain("Title with \\| pipe");
    });

    it("handles an empty manifest gracefully", () => {
        const md = renderSettingsMarkdown({});
        expect(md).toContain("0 commands across 0 categories");
    });
});

describe("renderDiagnosticsMarkdown", () => {
    it("produces counts table + active plugins", () => {
        const snap: DiagnosticsSnapshot = {
            capturedAt: new Date("2026-07-10T00:00:00Z"),
            terminalCount: 5,
            unseenTerminalCount: 2,
            mDNSServiceCount: 12,
            todoItemCount: 30,
            projectsTodoProjectCount: 4,
            activePluginIds: ["terminals", "mdns", "todo"],
        };
        const md = renderDiagnosticsMarkdown(snap);
        expect(md).toContain("# Superset Diagnostics");
        expect(md).toContain("| Tracked terminals | 5 |");
        expect(md).toContain("| mDNS services | 12 |");
        expect(md).toContain("- terminals");
        expect(md).toContain("- mdns");
        expect(md).toContain("- todo");
    });

    it("reports zero active plugins gracefully", () => {
        const md = renderDiagnosticsMarkdown({
            capturedAt: new Date("2026-07-10T00:00:00Z"),
            terminalCount: 0,
            unseenTerminalCount: 0,
            mDNSServiceCount: 0,
            todoItemCount: 0,
            projectsTodoProjectCount: 0,
            activePluginIds: [],
        });
        expect(md).toContain("No plugins currently active");
    });
});