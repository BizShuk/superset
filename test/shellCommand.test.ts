import { describe, expect, it } from "vitest";
import { joinShellCommand, quoteShellArg } from "../src/shellCommand";

describe("shell command formatting", () => {
    it("quotes every argument passed to a command", () => {
        expect(joinShellCommand("ssh", ["pi@nas.local"])).toBe(
            "ssh 'pi@nas.local'"
        );
    });

    it("keeps a single quote and shell metacharacters inside one argument", () => {
        const hostile = "o'hara; touch /tmp/pwned";
        expect(quoteShellArg(hostile)).toBe(
            "'o'\\''hara; touch /tmp/pwned'"
        );
        expect(joinShellCommand("ssh", [hostile])).toBe(
            "ssh 'o'\\''hara; touch /tmp/pwned'"
        );
    });
});
