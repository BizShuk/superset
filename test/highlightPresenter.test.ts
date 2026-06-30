import { describe, it, expect, vi } from "vitest";
import { HighlightPresenter, UNSEEN_PREFIX } from "../src/terminals/highlightPresenter";
import { TerminalRegistry } from "../src/terminals/terminalRegistry";
import type { TerminalHandle } from "../src/terminals/types";

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

    it("degrades silently when terminal.name setter throws (VSCode 1.90+)", () => {
        // Simulate the runtime case where `terminal.name` is a getter-only
        // property. The presenter must catch the throw, log, and
        // continue updating the panel + status bar channels.
        const registry = new TerminalRegistry();
        const a = fakeTerminal("a");
        registry.add(a);

        const rec = recorder();
        const log = vi.fn();
        const presenter = new HighlightPresenter({
            registry,
            setTerminalName: () => {
                throw new TypeError(
                    "Cannot set property name of #<Object> which has only a getter"
                );
            },
            setStatusBarText: (text) => rec.statusBarTexts.push(text),
            showStatusBar: () => rec.statusShown++,
            hideStatusBar: () => rec.statusHidden++,
            log,
        });
        presenter.start();

        // Should not throw even though setTerminalName always throws.
        expect(() => registry.markUnseen(a)).not.toThrow();

        // The presenter logged the degradation.
        const degradationLogs = log.mock.calls.filter((c) =>
            String(c[0]).includes("tab-name prefix disabled")
        );
        expect(degradationLogs.length).toBeGreaterThanOrEqual(1);

        // Panel + status bar channels are still updated.
        expect(rec.statusBarTexts).toContain("1 個終端機有新輸出");
        expect(rec.statusShown).toBe(1);
    });

    it("does not bind a status bar command when none is provided", () => {
        // Backward-compat: existing callers that don't supply a click
        // command must keep working without the presenter touching any
        // command binding.
        const { presenter, rec, registry, a } = setup();
        presenter.start();

        registry.markUnseen(a);
        registry.clearUnseen(a);

        // rec has no command recorder → proves we never required one.
        expect(rec.statusBarTexts[rec.statusBarTexts.length - 1]).toBe("");
        expect(rec.statusHidden).toBe(1);
    });

    it("binds the status bar command while unseen, clears it on hide", () => {
        // When the extension wires a click command, the presenter must
        // bind it exactly while the item is shown (>=1 unseen) and
        // clear it on hide (0 unseen) so a hidden entry never advertises
        // a stale click target. The command ID itself is the caller's
        // concern — the presenter just signals "show time" / "hide time".
        const registry = new TerminalRegistry();
        const a = fakeTerminal("a");
        registry.add(a);

        const rec = recorder();
        const setCommand = vi.fn();
        const clearCommand = vi.fn();
        const presenter = new HighlightPresenter({
            registry,
            setTerminalName: (terminal, name) => {
                rec.setNameCalls.push({ terminal, name });
                (terminal as { name: string }).name = name;
            },
            setStatusBarText: (text) => rec.statusBarTexts.push(text),
            showStatusBar: () => rec.statusShown++,
            hideStatusBar: () => rec.statusHidden++,
            setStatusBarCommand: setCommand,
            clearStatusBarCommand: clearCommand,
        });
        presenter.start();

        // No unseen at start → never shown, so no command binding.
        expect(setCommand).not.toHaveBeenCalled();
        expect(clearCommand).not.toHaveBeenCalled();

        // 1 unseen → command-bound, item shown.
        registry.markUnseen(a);
        expect(setCommand).toHaveBeenCalledTimes(1);
        expect(rec.statusShown).toBe(1);

        // 2 unseen → re-bound (idempotent: the contract is "every
        // refresh while shown fires the binding callback").
        const b = fakeTerminal("b");
        registry.add(b);
        registry.markUnseen(b);
        expect(setCommand).toHaveBeenCalledTimes(2);
        expect(rec.statusShown).toBe(2);

        // Clearing one of two unseen still leaves count > 0, so the
        // presenter re-enters the "show + bind" branch (not the
        // "hide + clear" branch). Document that by re-asserting the
        // counters advanced again.
        registry.clearUnseen(a);
        expect(setCommand).toHaveBeenCalledTimes(3);
        expect(clearCommand).toHaveBeenCalledTimes(0);
        expect(rec.statusHidden).toBe(0);

        // Clear the last unseen → command cleared, item hidden.
        registry.clearUnseen(b);
        expect(clearCommand).toHaveBeenCalledTimes(1);
        expect(rec.statusHidden).toBe(1);
        expect(rec.statusBarTexts[rec.statusBarTexts.length - 1]).toBe("");

        // Re-mark unseen → command bound again, item shown again.
        registry.markUnseen(a);
        expect(setCommand).toHaveBeenCalledTimes(4);
        expect(rec.statusShown).toBe(4);
    });
});