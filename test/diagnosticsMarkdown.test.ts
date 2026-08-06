// Tests for the pure diagnostics Markdown renderer. No
// `vscode` dependency — runs in vitest without any mock.

import { describe, expect, it } from "vitest";
import {
    renderDiagnosticsMarkdown,
    type DiagnosticsSnapshot,
} from "../src/diagnostics";

describe("renderDiagnosticsMarkdown", () => {
    it("produces counts table + active plugins", () => {
        const snap: DiagnosticsSnapshot = {
            capturedAt: new Date("2026-07-10T00:00:00Z"),
            terminalCount: 5,
            unseenTerminalCount: 2,
            mDNSServiceCount: 12,
            todoItemCount: 30,
            activePluginIds: ["terminals", "mdns", "todo"],
        };
        const md = renderDiagnosticsMarkdown(snap);
        expect(md).toContain("# Superset Diagnostics");
        expect(md).toContain("| Tracked terminals | 5 |");
        expect(md).toContain("| mDNS services | 12 |");
        expect(md).toContain("| TODO tasks (active workspace) | 30 |");
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
            activePluginIds: [],
        });
        expect(md).toContain("No plugins currently active");
    });

    it("distinguishes unavailable metrics from a real zero", () => {
        const md = renderDiagnosticsMarkdown({
            capturedAt: new Date("2026-07-10T00:00:00Z"),
            terminalCount: undefined,
            unseenTerminalCount: 0,
            mDNSServiceCount: undefined,
            todoItemCount: 0,
            activePluginIds: [],
        });

        expect(md).toContain("| Tracked terminals | Unavailable |");
        expect(md).toContain("| Terminals with unseen output | 0 |");
        expect(md).toContain("| mDNS services | Unavailable |");
    });
});
