import * as vscode from "vscode";
import { findFirstMermaidMatch } from "./mermaidTrigger";
import type { MermaidLineBuffer } from "./mermaidLineBuffer";
import type { MermaidMatch } from "./mermaidTrigger";
import type { TerminalHandle } from "./types";

/**
 * Clickable link provider that scans a terminal's recent lines for a
 * standalone `mermaid` keyword and, when VSCode asks "is this line a
 * link?", returns a {@link MermaidTerminalLink} spanning the keyword
 * plus the captured body text so {@link handleTerminalLink} can hand
 * it off to the preview command.
 *
 * VSCode passes the actual line *text* in `context.line` (not just an
 * index), so detection is a single `trim().toLowerCase() === "mermaid"`
 * probe — the buffer is only consulted to recover the body that lives
 * on subsequent lines (VSCode gives us only the current line).
 *
 * ANSI handling: the buffer strips ANSI on append, and VSCode gives
 * us the rendered (post-control) line text. So `context.line` and the
 * buffer entries should match character-for-character; the fall-back
 * "find any mermaid trigger in the buffer" path handles the case
 * where the very latest trigger sits past the buffer's 200-line cap.
 *
 * Linking the originating terminal to a click handler is tricky:
 * `TerminalLinkProvider.handleTerminalLink` receives only the link
 * object, not the terminal. We side-step this by stuffing both the
 * captured body and the originating terminal onto a plain object
 * (the same fields `vscode.TerminalLink` exposes — `startIndex`,
 * `length`, `tooltip` — plus our private `body` and `terminal`).
 */

export interface MermaidLinkClick {
    /** Terminal the click originated from (used for log lines, not body). */
    readonly terminal: TerminalHandle;
    /** Trimmed, joined mermaid source — ready to feed a mermaid renderer. */
    readonly body: string;
}

export interface MermaidLinkProviderDeps {
    readonly buffer: MermaidLineBuffer;
    /**
     * Callback fired when the user clicks the link. Receives the
     * captured body so the wiring layer can decide how to render
     * (delegate to an installed Mermaid Preview extension, open a
     * webview, write a temp `.md`, etc.).
     */
    readonly onClick: (event: MermaidLinkClick) => void;
    /** Diagnostic sink. */
    readonly log?: (msg: string) => void;
}

/**
 * Mermaid link object returned by the provider. Structurally matches
 * `vscode.TerminalLink` plus two extension fields. We use a plain
 * interface rather than subclassing `vscode.TerminalLink` so test
 * mocks don't need to ship a `TerminalLink` class — VSCode accepts
 * the object shape at registration time.
 */
export interface MermaidTerminalLink {
    startIndex: number;
    length: number;
    tooltip?: string;
    body: string;
    terminal?: TerminalHandle;
}

export class MermaidTerminalLinkProvider
    implements
        vscode.TerminalLinkProvider<MermaidTerminalLink>
{
    constructor(private readonly deps: MermaidLinkProviderDeps) {}

    provideTerminalLinks(
        context: vscode.TerminalLinkContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<MermaidTerminalLink[]> {
        const lineText = context.line;
        if (lineText.trim().toLowerCase() !== "mermaid") {
            return [];
        }
        // Find which buffer index this line corresponds to. Prefer the
        // exact-text match (newest occurrence), then fall back to the
        // newest line whose `trim()` equals `mermaid` (handles buffer
        // capacity rollover where the trigger text drifted slightly).
        const bufferLines = this.deps.buffer.getLines(context.terminal);
        const triggerIdx = this.locateTriggerLine(bufferLines, lineText);
        if (triggerIdx < 0) {
            return [];
        }
        const match = findFirstMermaidMatch(bufferLines, triggerIdx);
        if (!match || match.triggerLine !== triggerIdx) {
            return [];
        }
        const { start, length } = rangeFromTrigger(match);
        if (length <= 0) {
            return [];
        }
        this.deps.log?.(
            `[mermaid-link] match terminal="${context.terminal.name}" ` +
                `bufferIdx=${triggerIdx} range=${start}+${length} ` +
                `bodyLines=${match.bodyLines.length}`
        );
        return [
            {
                startIndex: start,
                length,
                tooltip: makeTooltip(match),
                body: match.bodyText,
                terminal: context.terminal,
            },
        ];
    }

    handleTerminalLink(link: MermaidTerminalLink): void {
        const terminal = link.terminal;
        if (!terminal) {
            this.deps.log?.(
                "[mermaid-link] handleTerminalLink called without attached terminal"
            );
            return;
        }
        this.deps.onClick({ terminal, body: link.body });
    }

    /**
     * Locate the index in `bufferLines` whose text corresponds to the
     * line VSCode just passed us. Returns -1 when the buffer is empty
     * or has been trimmed past the trigger.
     */
    private locateTriggerLine(
        bufferLines: readonly string[],
        lineText: string
    ): number {
        for (let i = bufferLines.length - 1; i >= 0; i--) {
            if (bufferLines[i] === lineText) {
                return i;
            }
        }
        for (let i = bufferLines.length - 1; i >= 0; i--) {
            if (
                (bufferLines[i] ?? "").trim().toLowerCase() === "mermaid"
            ) {
                return i;
            }
        }
        return -1;
    }
}

function rangeFromTrigger(
    match: MermaidMatch
): { start: number; length: number } {
    return {
        start: match.triggerRange.start,
        length: match.triggerRange.end - match.triggerRange.start,
    };
}

/** Hover text shown by VSCode when the cursor is over the link. Keeps
 *  the body's first line so users can tell at a glance which diagram
 *  the link opens without committing to a click. */
function makeTooltip(match: MermaidMatch): string {
    const firstLine =
        match.bodyLines.length > 0
            ? match.bodyText.split("\n", 1)[0] ?? ""
            : "";
    if (firstLine.length === 0) {
        return "Open Mermaid preview (empty body)";
    }
    return `Open Mermaid preview — ${firstLine}`;
}
