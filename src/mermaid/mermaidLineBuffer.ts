import type { TerminalHandle } from "../terminals/types";

/**
 * Per-terminal ring buffer of recent render-lines, fed by:
 *
 *   - `PtyTerminalFactory.onData(...)` for terminals this extension
 *     itself backed with a real PTY (so we see every byte, including
 *     TUI redraws — see `architecture-decision` in CLAUDE.md).
 *
 *   - `createShellExecutionFanOut.onChunk(...)` for built-in VSCode
 *     terminals whose data stream comes through shell-integration's
 *     `execution.read()` async iterator.
 *
 * The buffer is what the mermaid terminal-link provider queries
 * when VSCode asks "is this line a link?" — see
 * `mermaidLinkProvider.ts`. Without our own buffer the provider
 * only sees the single current line from VSCode's callback,
 * which is not enough to capture the body that lives on the
 * subsequent lines.
 *
 * ANSI escape sequences are stripped on the way in: shell prompts
 * and TUI frames wrap text in CSI sequences that would otherwise
 * pad the line and break the simple "trim + equal-mermaid" check
 * in `mermaidTrigger.ts`.
 */

const DEFAULT_MAX_LINES = 200;
const NEWLINE_RE = /\r?\n/;

/**
 * Lightweight ANSI-strip: covers CSI (`ESC [ … letter`), OSC
 * (`ESC ] … BEL/ST`), and lone control bytes that PTY escape
 * sequences typically emit. We don't aim for full VT100 fidelity —
 * only enough that the downstream trigger text matcher sees clean
 * logical content.
 */
const ANSI_ESCAPE_RE =
    /\[[0-9;?]*[a-zA-Z]|\][^\\x07]*(?:\x07|\\\)|[\x00-\x08\x0b-\x1f\x7f]/g;

function stripAnsi(text: string): string {
    return text.replace(ANSI_ESCAPE_RE, "");
}

export class MermaidLineBuffer {
    private readonly buffers = new Map<TerminalHandle, string[]>();
    /** Per-terminal partial line (no trailing newline yet). Merged with
     *  the head of the next chunk so cross-chunk `mermaid\ngraph TD`
     *  reads as two complete lines, not three. */
    private readonly partials = new Map<TerminalHandle, string>();
    private readonly maxLines: number;

    constructor(maxLines: number = DEFAULT_MAX_LINES) {
        if (maxLines <= 0) {
            throw new Error(
                `MermaidLineBuffer maxLines must be > 0, got ${maxLines}`
            );
        }
        this.maxLines = maxLines;
    }

    /**
     * Append a raw chunk (anything the PTY or shell-integration emitted
     * since the last call). Newline-bearing chunks split into multiple
     * complete lines; if the chunk ends without a newline, the trailing
     * fragment is held as a partial and merged into the next call.
     */
    append(terminal: TerminalHandle, data: string): void {
        if (data.length === 0) {
            return;
        }
        const cleaned = stripAnsi(data);
        if (cleaned.length === 0) {
            return;
        }
        const buf = this.getOrCreateBuf(terminal);
        const partial = this.partials.get(terminal);
        const endsWithNewline =
            cleaned.endsWith("\n") || cleaned.endsWith("\r");
        const parts = cleaned.split(NEWLINE_RE);

        // If we have a partial from the previous chunk, merge it into the
        // head split entry so a line that spans two chunks lands as one
        // entry instead of two.
        if (partial !== undefined) {
            parts[0] = partial + (parts[0] ?? "");
        }

        // The last split entry is either a partial (no terminator) or ""
        // (the trailing delimiter itself, when the chunk did terminate).
        // Either way we don't push it to `buf` — it's the partial slot's
        // problem if it has content; otherwise it represents nothing.
        const completeCount = parts.length - 1;
        for (let i = 0; i < completeCount; i++) {
            buf.push(parts[i] ?? "");
        }
        if (endsWithNewline) {
            this.partials.delete(terminal);
        } else {
            this.partials.set(terminal, parts[parts.length - 1] ?? "");
        }

        while (buf.length > this.maxLines) {
            buf.shift();
        }
    }

    /**
     * Snapshot of recent lines for `terminal`, oldest first. The trailing
     * partial line, if any, is included so callers see complete data
     * even between chunks.
     */
    getLines(terminal: TerminalHandle): readonly string[] {
        const buf = this.buffers.get(terminal);
        if (!buf) {
            return [];
        }
        const partial = this.partials.get(terminal);
        if (partial === undefined) {
            return buf.slice();
        }
        return [...buf, partial];
    }

    /** Drop all retained lines for `terminal` (call on terminal close). */
    clear(terminal: TerminalHandle): void {
        this.buffers.delete(terminal);
        this.partials.delete(terminal);
    }

    /** Drop everything (e.g., on extension deactivate). */
    clearAll(): void {
        this.buffers.clear();
        this.partials.clear();
    }

    /** Number of terminals currently tracked. Test helper. */
    get size(): number {
        return this.buffers.size;
    }

    /** Total lines currently buffered across all terminals. Test helper. */
    get totalLines(): number {
        let n = 0;
        for (const buf of this.buffers.values()) {
            n += buf.length;
        }
        // Each terminal's partial contributes a single line.
        n += this.partials.size;
        return n;
    }

    private getOrCreateBuf(terminal: TerminalHandle): string[] {
        let buf = this.buffers.get(terminal);
        if (!buf) {
            buf = [];
            this.buffers.set(terminal, buf);
        }
        return buf;
    }
}