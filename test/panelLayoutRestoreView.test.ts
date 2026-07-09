// panelLayoutRestoreView — pure restore helper tests. The function
// awaits a focus call and reports success/failure via a log
// callback; no `vscode` surface is touched.

import { describe, it, expect, vi } from "vitest";
import { tryRestore, type RestoreTarget } from "../src/panelLayout/restoreView";

function makeTarget(
    impl: () => Thenable<unknown>
): RestoreTarget {
    return { focus: impl };
}

describe("tryRestore", () => {
    it("returns false when no viewId supplied", async () => {
        const log = vi.fn();
        const ok = await tryRestore(undefined, new Map(), log);
        expect(ok).toBe(false);
        expect(log).not.toHaveBeenCalled();
    });

    it("returns false when the target map has no entry for the viewId", async () => {
        const log = vi.fn();
        const ok = await tryRestore(
            "superset.todo",
            new Map(),
            log
        );
        expect(ok).toBe(false);
        expect(log).toHaveBeenCalledWith(
            "panelLayout: restore — no target for viewId=superset.todo"
        );
    });

    it("calls focus and returns true on success", async () => {
        const focus = vi.fn().mockReturnValue(Promise.resolve());
        const log = vi.fn();
        const targets = new Map<string, RestoreTarget>([
            ["superset.todo", makeTarget(focus)],
        ]);
        const ok = await tryRestore("superset.todo", targets, log);
        expect(ok).toBe(true);
        expect(focus).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            "panelLayout: restored superset.todo"
        );
    });

    it("swallows focus rejections and returns false", async () => {
        const focus = vi
            .fn()
            .mockRejectedValue(new Error("view not registered"));
        const log = vi.fn();
        const targets = new Map<string, RestoreTarget>([
            ["superset.mdns", makeTarget(focus)],
        ]);
        const ok = await tryRestore("superset.mdns", targets, log);
        expect(ok).toBe(false);
        expect(log).toHaveBeenCalledWith(
            "panelLayout: restore superset.mdns failed: view not registered"
        );
    });

    it("never rethrows even for non-Error rejections", async () => {
        const focus = vi.fn().mockRejectedValue("string-error");
        const log = vi.fn();
        const targets = new Map<string, RestoreTarget>([
            ["superset.todo", makeTarget(focus)],
        ]);
        await expect(
            tryRestore("superset.todo", targets, log)
        ).resolves.toBe(false);
        expect(log).toHaveBeenCalledWith(
            "panelLayout: restore superset.todo failed: string-error"
        );
    });
});