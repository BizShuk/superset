import { describe, it, expect } from "vitest";
import {
    AGENT_IDS,
    buildShellCommand,
    DEFAULT_AGENT_COMMANDS,
    quoteShellPath,
    resolveAgentCommands,
    terminalNameFor,
} from "../src/cliLauncher/command";

describe("AGENT_IDS", () => {
    it("exposes exactly the three side panel buttons", () => {
        expect([...AGENT_IDS]).toEqual(["claude", "codex", "grok"]);
    });
});

describe("resolveAgentCommands", () => {
    it("falls back to same-named CLIs", () => {
        expect(resolveAgentCommands(undefined)).toEqual(DEFAULT_AGENT_COMMANDS);
    });

    it("applies trimmed overrides only for valid strings", () => {
        expect(
            resolveAgentCommands({
                claude: "  claude --dangerously-skip-permissions  ",
                codex: "",
                grok: 42,
                unknown: "ignored",
            })
        ).toEqual({
            claude: "claude --dangerously-skip-permissions",
            codex: "codex",
            grok: "grok",
        });
    });
});

describe("quoteShellPath", () => {
    it("quotes paths with spaces", () => {
        expect(quoteShellPath("/Users/tester/my projects")).toBe(
            `'/Users/tester/my projects'`
        );
    });

    it("escapes embedded single quotes", () => {
        expect(quoteShellPath(`/tmp/it's here`)).toBe(`'/tmp/it'\\''s here'`);
    });

    it("prevents variable expansion", () => {
        expect(quoteShellPath("/tmp/$HOME")).toBe(`'/tmp/$HOME'`);
    });
});

describe("buildShellCommand", () => {
    it("chains cd with the command so a reused terminal still lands in the right cwd", () => {
        expect(buildShellCommand("/opt/web", "claude")).toBe(
            `cd '/opt/web' && claude`
        );
    });

    it("emits only cd when no command is configured", () => {
        expect(buildShellCommand("/opt/web", "   ")).toBe(`cd '/opt/web'`);
    });
});

describe("terminalNameFor", () => {
    it("suffixes the agent so each button reuses its own terminal", () => {
        expect(terminalNameFor("web", "codex")).toBe("web · codex");
    });

    it("uses the bare label for the default click action", () => {
        expect(terminalNameFor("web")).toBe("web");
    });
});
