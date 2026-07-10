import { describe, expect, it, beforeEach } from "vitest";
import { MermaidLineBuffer } from "../src/mermaid/mermaidLineBuffer";

/** Anonymous stand-in for vscode.Terminal: any unique object satisfies
 *  the buffer's Map-key contract since identity is what matters. */
function makeTerminal(name: string): { name: string } {
    return { name };
}

describe("MermaidLineBuffer", () => {
    let buf: MermaidLineBuffer;
    beforeEach(() => {
        buf = new MermaidLineBuffer();
    });

    it("returns empty lines for an unseen terminal", () => {
        const t = makeTerminal("zsh");
        expect(buf.getLines(t)).toEqual([]);
    });

    it("splits chunks on newline and keeps trailing partial line", () => {
        const t = makeTerminal("zsh");
        buf.append(t, "first\nsecond\nthi");
        expect(buf.getLines(t)).toEqual(["first", "second", "thi"]);
        buf.append(t, "rd\nfourth");
        expect(buf.getLines(t)).toEqual(["first", "second", "third", "fourth"]);
    });

    it("does not accumulate phantom empty entries between newline-terminated chunks", () => {
        const t = makeTerminal("zsh");
        buf.append(t, "line1\n");
        buf.append(t, "line2\n");
        expect(buf.getLines(t)).toEqual(["line1", "line2"]);
    });

    it("strips ANSI escape sequences from incoming chunks", () => {
        const t = makeTerminal("zsh");
        buf.append(
            t,
            "[32mgreen prompt[0m $ echo hello\nhello world\n"
        );
        expect(buf.getLines(t)).toEqual(["green prompt $ echo hello", "hello world"]);
    });

    it("handles \\r\\n line endings", () => {
        const t = makeTerminal("zsh");
        buf.append(t, "windows-style\r\nline2\r\nline3");
        expect(buf.getLines(t)).toEqual(["windows-style", "line2", "line3"]);
    });

    it("respects the line cap and drops oldest lines first", () => {
        const small = new MermaidLineBuffer(3);
        const t = makeTerminal("zsh");
        small.append(t, "a\nb\nc\nd\ne\n");
        expect(small.getLines(t)).toEqual(["c", "d", "e"]);
    });

    it("isolates buffers per terminal", () => {
        const t1 = makeTerminal("zsh-1");
        const t2 = makeTerminal("zsh-2");
        buf.append(t1, "alpha\nbeta\n");
        buf.append(t2, "gamma\n");
        expect(buf.getLines(t1)).toEqual(["alpha", "beta"]);
        expect(buf.getLines(t2)).toEqual(["gamma"]);
        expect(buf.size).toBe(2);
    });

    it("clear() removes only the targeted terminal's lines", () => {
        const t1 = makeTerminal("zsh-1");
        const t2 = makeTerminal("zsh-2");
        buf.append(t1, "x\n");
        buf.append(t2, "y\n");
        buf.clear(t1);
        expect(buf.getLines(t1)).toEqual([]);
        expect(buf.getLines(t2)).toEqual(["y"]);
        expect(buf.size).toBe(1);
    });

    it("clearAll() drops every terminal", () => {
        buf.append(makeTerminal("a"), "1\n");
        buf.append(makeTerminal("b"), "2\n");
        buf.clearAll();
        expect(buf.size).toBe(0);
        expect(buf.totalLines).toBe(0);
    });

    it("ignores empty chunks without growing the buffer", () => {
        const t = makeTerminal("zsh");
        buf.append(t, "");
        expect(buf.getLines(t)).toEqual([]);
        buf.append(t, "\n");
        expect(buf.getLines(t)).toEqual([""]);
    });

    it("rejects non-positive maxLines", () => {
        expect(() => new MermaidLineBuffer(0)).toThrow();
        expect(() => new MermaidLineBuffer(-5)).toThrow();
    });
});