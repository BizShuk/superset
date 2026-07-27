import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
    window: {
        onDidStartTerminalShellExecution: vi.fn(),
    },
}));

import * as vscode from "vscode";
import { createShellExecutionSource } from "../src/terminals/shellExecutionSource";

describe("createShellExecutionSource diagnostic logging", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("logs stream metadata without command or output payloads", async () => {
        let fire:
            | ((event: {
                  terminal: { name: string };
                  execution: {
                      commandLine: { value: string };
                      read(): AsyncIterable<string>;
                  };
              }) => void)
            | undefined;
        vi.mocked(
            vscode.window.onDidStartTerminalShellExecution
        ).mockImplementation(((listener: typeof fire) => {
            fire = listener;
            return { dispose: vi.fn() };
        }) as never);

        const commandSecret = "TOKEN=command-secret npm test";
        const outputSecret = "response contains output-secret";
        const log = vi.fn();
        const onData = vi.fn();
        const source = createShellExecutionSource(log);
        source((event) => event.execution.onData(onData));

        fire?.({
            terminal: { name: "test" },
            execution: {
                commandLine: { value: commandSecret },
                async *read() {
                    yield outputSecret;
                },
            },
        });

        await vi.waitFor(() => expect(onData).toHaveBeenCalledWith(outputSecret));

        const messages = log.mock.calls.flat().join("\n");
        expect(messages).not.toContain(commandSecret);
        expect(messages).not.toContain(outputSecret);
        expect(messages).toContain(`${outputSecret.length}B`);
    });
});
