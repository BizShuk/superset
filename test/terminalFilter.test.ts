import { describe, it, expect } from "vitest";
import { shouldTrackTerminal } from "../src/terminals/terminalFilter";

describe("shouldTrackTerminal", () => {
    it("tracks ordinary terminals", () => {
        expect(shouldTrackTerminal("bash")).toBe(true);
        expect(shouldTrackTerminal("zsh")).toBe(true);
    });

    it("tracks terminals carrying options Superset never inspects", () => {
        // Location, custom shell and extension-owned pseudoterminals used to
        // gate the auto-replace decision. Nothing replaces terminals now, so
        // the name is the only thing that can exclude one.
        expect(shouldTrackTerminal("editor-term")).toBe(true);
        expect(shouldTrackTerminal("fish")).toBe(true);
    });

    it("excludes the Antigravity Agent terminal", () => {
        expect(shouldTrackTerminal("Antigravity Agent")).toBe(false);
    });

    it("excludes antigravity terminals case-insensitively", () => {
        expect(shouldTrackTerminal("antigravity-1")).toBe(false);
        expect(shouldTrackTerminal("ANTIGRAVITY")).toBe(false);
    });

    it("excludes any terminal whose name contains antigravity", () => {
        expect(shouldTrackTerminal("my antigravity worker")).toBe(false);
    });
});
