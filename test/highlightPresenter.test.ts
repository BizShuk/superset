import { describe, it, expect, vi } from "vitest";
import { HighlightPresenter, UNSEEN_PREFIX } from "../src/highlightPresenter";
import { TerminalRegistry } from "../src/terminalRegistry";
import type { TerminalHandle } from "../src/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

interface Recorder {
    setNameCalls: Array<{ terminal: TerminalHandle; name: string }>;
    statusBarTexts: string[];
    statusShown: number;
    statusHidden: number;
}

function recorder(): Recorder {
    return {
        setNameCalls: [],
        statusBarTexts: [],
        statusShown: 0,
        statusHidden: 0,
    };
}

function setup() {
    const registry = new TerminalRegistry();
    const a = fakeTerminal("a");
    const b = fakeTerminal("b");
    registry.add(a);
    registry.add(b);

    const rec = recorder();
    const presenter = new HighlightPresenter({
        registry,
        setTerminalName: (terminal, name) => {
            rec.setNameCalls.push({ terminal, name });
            // Mutate the fake terminal so subsequent reads see the new name.
            (terminal as { name: string }).name = name;
        },
        setStatusBarText: (text) => rec.statusBarTexts.push(text),
        showStatusBar: () => rec.statusShown++,
        hideStatusBar: () => rec.statusHidden++,
    });

    return { registry, presenter, rec, a, b };
}

describe("HighlightPresenter", () => {
    it("does nothing while nothing is unseen", () => {
        const { presenter, rec } = setup();
        presenter.start();

        expect(rec.setNameCalls).toHaveLength(0);
        expect(rec.statusBarTexts).toHaveLength(0);
        expect(rec.statusShown).toBe(0);
        expect(rec.statusHidden).toBe(0);
    });

    it("prefixes unseen terminal name and updates status bar", () => {
        const { presenter, rec, registry, a } = setup();
        presenter.start();

        registry.markUnseen(a);

        const aCall = rec.setNameCalls.find((c) => c.terminal === a);
        expect(aCall?.name).toBe(`${UNSEEN_PREFIX}a`);
        expect(rec.statusBarTexts).toContain("1 個終端機有新輸出");
        expect(rec.statusShown).toBe(1);
    });

    it("shows plural text when more than one unseen", () => {
        const { presenter, rec, registry, a, b } = setup();
        presenter.start();

        registry.markUnseen(a);
        registry.markUnseen(b);

        expect(rec.statusBarTexts[rec.statusBarTexts.length - 1]).toBe(
            "2 個終端機有新輸出"
        );
    });

    it("preserves user rename on clear (does not restore old name)", () => {
        const { presenter, registry, a } = setup();
        presenter.start();

        registry.markUnseen(a);
        // a.name is now "● a" (presenter set it via setTerminalName)
        expect(a.name).toBe("● a");

        // User manually renames the terminal via VSCode UI. The new
        // name has no prefix.
        (a as { name: string }).name = "my-renamed";

        registry.clearUnseen(a);

        // Final name must reflect the user's rename, not the original "a".
        // The presenter must NOT have called setName with "a" at any point
        // after the rename.
        expect(a.name).toBe("my-renamed");
    });

    it("hides status bar when last unseen is cleared", () => {
        const { presenter, rec, registry, a } = setup();
        presenter.start();

        registry.markUnseen(a);
        registry.clearUnseen(a);

        expect(rec.statusHidden).toBe(1);
        expect(rec.statusBarTexts[rec.statusBarTexts.length - 1]).toBe("");
    });

    it("updates status bar text when unseen count changes", () => {
        const { presenter, rec, registry, a, b } = setup();
        presenter.start();

        registry.markUnseen(a);
        registry.markUnseen(b);
        registry.clearUnseen(a);

        expect(rec.statusBarTexts[rec.statusBarTexts.length - 1]).toBe(
            "1 個終端機有新輸出"
        );
    });

    it("does not double-prefix when markUnseen fires twice without clear", () => {
        const { presenter, rec, registry, a } = setup();
        presenter.start();

        registry.markUnseen(a);
        rec.setNameCalls.length = 0;

        // Idempotent at the registry level → no event → no second prefix.
        registry.markUnseen(a);

        expect(rec.setNameCalls).toHaveLength(0);
    });

    it("stop() unsubscribes", () => {
        const { presenter, rec, registry, a } = setup();
        presenter.start();
        presenter.stop();

        registry.markUnseen(a);

        expect(rec.setNameCalls).toHaveLength(0);
    });
});