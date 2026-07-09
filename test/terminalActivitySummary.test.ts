// Tests for the pure helpers in src/terminalActivitySummary. No
// `vscode` dependency — runs in vitest without any mock.

import { describe, expect, it } from "vitest";
import {
    captureSnapshot,
    renderActivityMarkdown,
    type TerminalActivityRow,
} from "../src/terminalActivitySummary";

function makeRow(over: Partial<TerminalActivityRow> = {}): TerminalActivityRow {
    return {
        name: "bash",
        hiddenFromUser: false,
        isPtyBacked: false,
        hasUnseen: false,
        ...over,
    };
}

describe("renderActivityMarkdown", () => {
    it("produces a header + table for non-empty rows", () => {
        const md = renderActivityMarkdown(
            [
                makeRow({ name: "bash", hasUnseen: true }),
                makeRow({ name: "Superset TUI", isPtyBacked: true }),
            ],
            new Date("2026-07-10T00:00:00Z")
        );
        expect(md).toContain("# Terminal Activity Summary");
        expect(md).toContain("`bash`");
        expect(md).toContain("`Superset TUI`");
        expect(md).toContain("**yes**"); // hasUnseen row
        expect(md).toContain("Per-terminal details");
    });

    it("reports zero terminals gracefully", () => {
        const md = renderActivityMarkdown(
            [],
            new Date("2026-07-10T00:00:00Z")
        );
        expect(md).toContain("No terminals currently tracked");
    });

    it("escapes pipe characters in terminal names", () => {
        const md = renderActivityMarkdown(
            [makeRow({ name: "weird|name" })],
            new Date("2026-07-10T00:00:00Z")
        );
        expect(md).toContain("weird\\|name");
    });
});

describe("captureSnapshot", () => {
    it("reads from the registry's entries", () => {
        const fakeTerminal = {
            name: "bash",
            processId: 42,
            creationOptions: { cwd: "/ws", hideFromUser: false, pty: false },
        } as unknown as Parameters<ReturnType<typeof captureSnapshot>["entries"] extends never ? never : (e: unknown) => void>;
        const fakeRegistry = {
            getAll: () => [
                {
                    id: "1",
                    terminal: fakeTerminal,
                    hasUnseenOutput: true,
                },
            ],
        };
        const rows = captureSnapshot(fakeRegistry as any);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.name).toBe("bash");
        expect(rows[0]?.processId).toBe(42);
        expect(rows[0]?.cwd).toBe("/ws");
        expect(rows[0]?.hasUnseen).toBe(true);
    });
});