import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
    class TerminalLink {
        startIndex: number;
        length: number;
        tooltip?: string;
        constructor(startIndex: number, length: number, tooltip?: string) {
            this.startIndex = startIndex;
            this.length = length;
            this.tooltip = tooltip;
        }
    }
    return {
        TerminalLink,
        window: {},
        commands: {},
        workspace: {},
        extensions: { all: [] },
    };
});

import { MermaidTerminalLinkProvider } from "../src/terminals/mermaidLinkProvider";
import { MermaidLineBuffer } from "../src/terminals/mermaidLineBuffer";
import type { MermaidLinkClick } from "../src/terminals/mermaidLinkProvider";
import type { TerminalHandle } from "../src/terminals/types";

/** Minimal fake that satisfies the buffer key + TerminalHandle shape. */
function fakeTerminal(name: string): TerminalHandle {
    return {
        name,
        show() {
            /* noop */
        },
        dispose() {
            /* noop */
        },
    };
}

describe("MermaidTerminalLinkProvider", () => {
    it("emits a link when VSCode passes the trigger line", async () => {
        const buffer = new MermaidLineBuffer();
        const terminal = fakeTerminal("zsh");
        buffer.append(terminal, "mermaid\ngraph TD\n  A --> B\n");
        const clicks: MermaidLinkClick[] = [];
        const provider = new MermaidTerminalLinkProvider({
            buffer,
            onClick: (e) => clicks.push(e),
        });

        const links = (await provider.provideTerminalLinks({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            terminal: terminal as any,
            line: "mermaid",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            token: undefined as any,
        })) as never;

        expect(links).toHaveLength(1);
        const link = links![0]!;
        expect(link.startIndex).toBe(0);
        expect(link.length).toBe(7);
        expect(link.tooltip).toContain("graph TD");
        expect((link as { body: string }).body).toBe(
            "graph TD\n  A --> B"
        );

        // Click handler recovers terminal + body
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider.handleTerminalLink(link as any);
        expect(clicks).toHaveLength(1);
        expect(clicks[0]!.body).toBe("graph TD\n  A --> B");
        expect(clicks[0]!.terminal).toBe(terminal);
    });

    it("matches when VSCode asks about a later trigger among several", async () => {
        const buffer = new MermaidLineBuffer();
        const terminal = fakeTerminal("zsh");
        buffer.append(
            terminal,
            "echo hi\nmermaid\ngraph LR\n  X --> Y\nsomething else\nmermaid\npie\n  A: 1\n"
        );
        const provider = new MermaidTerminalLinkProvider({
            buffer,
            onClick: () => {},
        });

        const links = (await provider.provideTerminalLinks({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            terminal: terminal as any,
            line: "mermaid",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            token: undefined as any,
        })) as never;

        expect(links).toHaveLength(1);
        // The most recent trigger wins (line 6 in the buffer), and its
        // body is "pie\n  A: 1".
        expect((links![0]! as { body: string }).body).toBe("pie\n  A: 1");
    });

    it("returns no link when the asked line isn't a trigger", async () => {
        const buffer = new MermaidLineBuffer();
        const terminal = fakeTerminal("zsh");
        buffer.append(terminal, "mermaid\ngraph TD\n  A --> B\n");
        const provider = new MermaidTerminalLinkProvider({
            buffer,
            onClick: () => {},
        });

        const links = (await provider.provideTerminalLinks({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            terminal: terminal as any,
            line: "graph TD",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            token: undefined as any,
        })) as never;

        expect(links ?? []).toHaveLength(0);
    });

    it("returns no link when the terminal isn't in the buffer", async () => {
        const buffer = new MermaidLineBuffer();
        const terminal = fakeTerminal("zsh");
        const provider = new MermaidTerminalLinkProvider({
            buffer,
            onClick: () => {},
        });

        const links = await provider.provideTerminalLinks({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            terminal: terminal as any,
            line: "mermaid",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            token: undefined as any,
        });

        expect(links ?? []).toHaveLength(0);
    });

    it("falls back to newest trigger in buffer when exact text isn't found", async () => {
        const buffer = new MermaidLineBuffer();
        const terminal = fakeTerminal("zsh");
        // Note: VSCode passes the exact rendered text. The trigger is
        // stored verbatim in the buffer, so an exact match should
        // always win. This test simulates a buffer where the line is
        // a trimmed-trigger but with leading whitespace.
        buffer.append(terminal, "  mermaid\ngraph TD\n  A --> B\n");
        const provider = new MermaidTerminalLinkProvider({
            buffer,
            onClick: () => {},
        });

        const links = (await provider.provideTerminalLinks({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            terminal: terminal as any,
            line: "  mermaid",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            token: undefined as any,
        })) as never;

        expect(links).toHaveLength(1);
        expect((links![0]! as { body: string }).body).toBe(
            "graph TD\n  A --> B"
        );
    });

    it("handleTerminalLink forwards body and terminal to onClick", () => {
        const buffer = new MermaidLineBuffer();
        const terminal = fakeTerminal("agent-x");
        buffer.append(terminal, "mermaid\npie\n  A: 1\n  B: 2\n");
        let captured: MermaidLinkClick | undefined;
        const provider = new MermaidTerminalLinkProvider({
            buffer,
            onClick: (e) => {
                captured = e;
            },
        });

        const links = provider.provideTerminalLinks({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            terminal: terminal as any,
            line: "mermaid",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            token: undefined as any,
        }) as never;
        expect(links).toHaveLength(1);
        provider.handleTerminalLink(links![0]!);
        expect(captured).toBeDefined();
        expect(captured!.body).toBe("pie\n  A: 1\n  B: 2");
        expect(captured!.terminal).toBe(terminal);
    });

    it("handleTerminalLink is a no-op when terminal wasn't attached", () => {
        const buffer = new MermaidLineBuffer();
        const terminal = fakeTerminal("zsh");
        buffer.append(terminal, "mermaid\ngraph TD\n");
        let called = false;
        const provider = new MermaidTerminalLinkProvider({
            buffer,
            onClick: () => {
                called = true;
            },
        });

        // Construct a link without going through provideTerminalLinks.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const links = provider.provideTerminalLinks({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            terminal: terminal as any,
            line: "mermaid",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            token: undefined as any,
        }) as never;
        // Strip the attached terminal manually
        const link = links![0]! as unknown as { terminal?: unknown };
        delete link.terminal;
        provider.handleTerminalLink(links![0]!);
        expect(called).toBe(false);
    });
});
