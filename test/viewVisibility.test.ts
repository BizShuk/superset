import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const vscodeMocks = vi.hoisted(() => ({
    executeCommand: vi.fn(),
}));

vi.mock("vscode", () => ({
    commands: {
        executeCommand: vscodeMocks.executeCommand,
    },
}));

import { registerViewVisibility } from "../src/plugin/viewVisibility";

describe("registerViewVisibility", () => {
    it("forwards boolean lifecycle state and reports only visible events", () => {
        let listener:
            | ((event: { readonly visible: boolean }) => void)
            | undefined;
        const dispose = vi.fn();
        const view = {
            visible: false,
            onDidChangeVisibility: vi.fn(
                (registered: typeof listener) => {
                    listener = registered;
                    return { dispose };
                }
            ),
        };
        const onVisibilityChange = vi.fn();

        const registration = registerViewVisibility(
            view as unknown as Pick<
                vscode.TreeView<unknown>,
                "visible" | "onDidChangeVisibility"
            >,
            "superset.test",
            onVisibilityChange
        );

        expect(onVisibilityChange).toHaveBeenCalledWith(false);

        listener?.({ visible: false });
        expect(vscodeMocks.executeCommand).not.toHaveBeenCalled();

        listener?.({ visible: true });
        expect(onVisibilityChange).toHaveBeenLastCalledWith(true);
        expect(vscodeMocks.executeCommand).toHaveBeenCalledWith(
            "superset.reportViewVisible",
            "superset.test"
        );

        registration.dispose();
        expect(dispose).toHaveBeenCalledOnce();
    });
});
