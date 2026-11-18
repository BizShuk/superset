import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

vi.mock("vscode", () => ({}));

import { registerViewVisibility } from "../src/plugin/viewVisibility";

describe("registerViewVisibility", () => {
    it("forwards the initial and changed boolean visibility state", () => {
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
            onVisibilityChange
        );

        expect(onVisibilityChange).toHaveBeenCalledWith(false);

        listener?.({ visible: true });
        expect(onVisibilityChange).toHaveBeenLastCalledWith(true);

        listener?.({ visible: false });
        expect(onVisibilityChange).toHaveBeenLastCalledWith(false);

        registration.dispose();
        expect(dispose).toHaveBeenCalledOnce();
    });
});
