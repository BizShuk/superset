// Tests for the pure helpers in `src/git/gitReset.ts`. These are
// the easy-to-reason-about layer: no `vscode` mocking, just data in
// / data out. The orchestration layer (`src/git/index.ts`) is
// exercised in `gitPlugin.test.ts` and indirectly via the
// `installCommands` integration tests (same spawner + terminal
// bridge pattern).

import { describe, it, expect } from "vitest";
import {
    buildResetCmdline,
    formatResetHardWarning,
    parseScmArgs,
    shortSha,
} from "../src/git/gitReset";

describe("buildResetCmdline", () => {
    it("emits `git reset --hard <sha>` with the SHA single-quoted for the hard mode", () => {
        expect(
            buildResetCmdline("abc1234def567890", "hard")
        ).toBe("git reset --hard 'abc1234def567890'");
    });

    it("emits `git reset --soft <sha>` with the SHA single-quoted for the soft mode", () => {
        expect(
            buildResetCmdline("abc1234def567890", "soft")
        ).toBe("git reset --soft 'abc1234def567890'");
    });

    it("quotes an empty SHA as `''` so the cmdline stays syntactically valid (defensive — VSCode's history provider shouldn't ever return this)", () => {
        // Empty SHA would cause `git reset --hard ''` to error
        // out, but the single-quote wrapping keeps the shell parser
        // happy and produces a predictable error from git itself.
        expect(buildResetCmdline("", "hard")).toBe(
            "git reset --hard ''"
        );
    });

    it("escapes embedded single quotes in the SHA via the standard `close-quote / escaped-quote / reopen` trick", () => {
        // A SHA containing a single quote is unrealistic (git SHAs
        // are hex) but the helper MUST stay safe — `spawnRunTerminal`
        // relies on this to avoid shell injection if a malicious
        // provider ever returns a crafted id.
        expect(buildResetCmdline("a'b", "soft")).toBe(
            "git reset --soft 'a'\\''b'"
        );
    });
});

describe("parseScmArgs", () => {
    it("extracts repository + historyItem from a well-formed `(SourceControl, SourceControlHistoryItem)` pair", () => {
        const repo = { rootUri: { fsPath: "/repo" } };
        const item = { id: "abc1234", message: "feat: thing" };
        expect(parseScmArgs([repo, item])).toEqual({
            repository: repo,
            historyItem: item,
        });
    });

    it("accepts a repository whose `rootUri` is undefined (no repo root — use workspace fallback)", () => {
        const repo = { rootUri: undefined };
        const item = { id: "abc1234" };
        expect(parseScmArgs([repo, item])).toEqual({
            repository: repo,
            historyItem: item,
        });
    });

    it("returns nulls when called from the command palette (no args)", () => {
        expect(parseScmArgs([])).toEqual({
            repository: null,
            historyItem: null,
        });
    });

    it("returns nulls when given a non-array (defensive — VSCode normally passes an array but we never trust inputs)", () => {
        expect(parseScmArgs(undefined)).toEqual({
            repository: null,
            historyItem: null,
        });
        expect(parseScmArgs(null)).toEqual({
            repository: null,
            historyItem: null,
        });
        expect(parseScmArgs("nope")).toEqual({
            repository: null,
            historyItem: null,
        });
    });

    it("returns nulls when the first arg has the wrong shape (no `rootUri` with a string `fsPath`)", () => {
        // `rootUri` is an object but `fsPath` is a number — reject.
        expect(
            parseScmArgs([{ rootUri: { fsPath: 42 } }, { id: "abc" }])
        ).toEqual({ repository: null, historyItem: null });
    });

    it("returns nulls when the second arg is missing the required `id: string`", () => {
        expect(
            parseScmArgs([
                { rootUri: { fsPath: "/repo" } },
                { message: "no id here" },
            ])
        ).toEqual({ repository: null, historyItem: null });
    });

    it("returns nulls when only one arg is supplied (the SCM Graph menu always passes two)", () => {
        expect(parseScmArgs([{ rootUri: { fsPath: "/repo" } }])).toEqual({
            repository: null,
            historyItem: null,
        });
    });
});

describe("formatResetHardWarning", () => {
    it("shows the short SHA (first 7 chars) and the commit subject in the modal text", () => {
        const text = formatResetHardWarning(
            "abc1234567890def",
            "feat: add SCM reset commands"
        );
        expect(text).toContain("git reset --hard abc1234");
        expect(text).toContain("feat: add SCM reset commands");
    });

    it("truncates subjects longer than 80 characters with an ellipsis so the dialog stays readable", () => {
        const longSubject = "a".repeat(120);
        const text = formatResetHardWarning("abc1234567890def", longSubject);
        // 80 chars + ellipsis (the U+2026 horizontal ellipsis);
        // the text body should still reference the truncated form.
        expect(text).toContain(`${"a".repeat(80)}…`);
        // And NOT contain the full un-truncated form (which would
        // be 120 chars of `a`).
        expect(text).not.toContain("a".repeat(81));
    });

    it("falls back to `(no subject)` when the subject is undefined or empty", () => {
        const textNone = formatResetHardWarning(
            "abc1234567890def",
            undefined
        );
        expect(textNone).toContain("(no subject)");

        const textEmpty = formatResetHardWarning(
            "abc1234567890def",
            "   "
        );
        expect(textEmpty).toContain("(no subject)");
    });

    it("uses the full SHA when it's already shorter than 7 characters (defensive — git normally returns the 40-char SHA)", () => {
        const text = formatResetHardWarning("abc", "init");
        // SHA is shorter than 7 chars, so the warning shows it in
        // full rather than slicing to a shorter prefix. We assert
        // on the trailing boundary to avoid the obvious prefix
        // collision (e.g. `a` is a substring of `abc`).
        expect(text).toContain("git reset --hard abc");
        expect(text).toMatch(/git reset --hard abc\b/);
    });

    it("mentions that data is irrecoverable so the user understands the destructive nature", () => {
        const text = formatResetHardWarning(
            "abc1234567890def",
            "feat: thing"
        );
        // The 繁體中文 modal copy warns about permanent loss.
        expect(text).toMatch(/永久丟失|無法回復|irrecoverable|destructive/i);
    });
});

describe("shortSha", () => {
    it("returns the first 7 chars of a long SHA", () => {
        expect(shortSha("abc1234def567890")).toBe("abc1234");
    });

    it("returns the input unchanged when it is shorter than 7 chars", () => {
        expect(shortSha("abc")).toBe("abc");
    });

    it("returns an empty string unchanged when the input is empty", () => {
        expect(shortSha("")).toBe("");
    });
});