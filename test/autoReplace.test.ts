import { describe, it, expect } from "vitest";
import { decideAutoReplace } from "../src/autoReplace";

describe("decideAutoReplace", () => {
    it("replaces a plain panel terminal (no special options)", () => {
        const d = decideAutoReplace({}, "bash");
        expect(d.replace).toBe(true);
    });

    it("skips agent-owned terminals by name (antigravity)", () => {
        expect(decideAutoReplace({}, "Antigravity Agent").replace).toBe(false);
        expect(decideAutoReplace({}, "antigravity-1").replace).toBe(false);
    });

    it("skips terminals that are already pseudoterminals", () => {
        // ExtensionTerminalOptions carries a `pty`; replacing would double-wrap.
        const d = decideAutoReplace({ pty: {} }, "Superset TUI");
        expect(d.replace).toBe(false);
    });

    it("skips terminals with a custom shell (shellPath/shellArgs)", () => {
        expect(decideAutoReplace({ shellPath: "/bin/fish" }, "fish").replace).toBe(
            false
        );
        expect(
            decideAutoReplace({ shellArgs: ["-lc", "htop"] }, "htop").replace
        ).toBe(false);
    });

    it("skips hidden background terminals (hideFromUser)", () => {
        const d = decideAutoReplace({ hideFromUser: true }, "bg");
        expect(d.replace).toBe(false);
    });

    it("skips non-panel terminals (editor area / split) — the editor-area bug", () => {
        // TerminalLocation.Editor === 2 in the vscode enum; any defined
        // location means we cannot faithfully reproduce placement.
        expect(decideAutoReplace({ location: 2 }, "editor-term").replace).toBe(
            false
        );
        // Split location is an object referencing a parent terminal.
        expect(
            decideAutoReplace(
                { location: { parentTerminal: {} } },
                "split-term"
            ).replace
        ).toBe(false);
    });

    it("returns a human-readable reason for diagnostics", () => {
        expect(decideAutoReplace({ location: 2 }, "x").reason).toMatch(/location/);
        expect(decideAutoReplace({}, "x").reason).toMatch(/plain/);
    });
});
