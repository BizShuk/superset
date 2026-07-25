// editorLayoutStorage — mode persistence. The grid shape is
// deliberately absent from this module: it is re-read from
// `vscode.getEditorLayout` on every apply, so a grid the user reshaped
// by hand is observed rather than replayed from a stale record.

import { describe, it, expect } from "vitest";
import {
    EDITOR_LAYOUT_MODE_KEY,
    readLayoutMode,
    writeLayoutMode,
} from "../src/editorLayout/modeStorage";
import { EDITOR_LAYOUT_MODES } from "../src/editorLayout/layoutModes";

interface FakeState {
    store: Record<string, unknown>;
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Promise<void>;
}

function makeFake(initial: Record<string, unknown> = {}): FakeState {
    const store: Record<string, unknown> = { ...initial };
    return {
        store,
        get: <T>(key: string): T | undefined => store[key] as T | undefined,
        update: async (key: string, value: unknown) => {
            store[key] = value;
        },
    };
}

describe("readLayoutMode", () => {
    it("returns undefined when no record exists", () => {
        expect(readLayoutMode(makeFake())).toBeUndefined();
    });

    it("returns each of the four modes verbatim", () => {
        for (const mode of EDITOR_LAYOUT_MODES) {
            const state = makeFake({ [EDITOR_LAYOUT_MODE_KEY]: mode });
            expect(readLayoutMode(state)).toBe(mode);
        }
    });

    it("discards values outside the four-mode state space", () => {
        // "h-even" / "v-max" are the superseded single-axis ids: a
        // stale record must fall back to the default, not be replayed.
        for (const junk of ["h-even", "v-max", "EVEN-EVEN", "", 3, null, {}]) {
            const state = makeFake({ [EDITOR_LAYOUT_MODE_KEY]: junk });
            expect(readLayoutMode(state), String(junk)).toBeUndefined();
        }
    });
});

describe("writeLayoutMode", () => {
    it("writes a valid mode and reports success", async () => {
        const state = makeFake();
        expect(await writeLayoutMode(state, "max-max")).toBe(true);
        expect(state.store[EDITOR_LAYOUT_MODE_KEY]).toBe("max-max");
    });

    it("rejects an invalid mode without writing", async () => {
        const state = makeFake();
        expect(
            await writeLayoutMode(state, "diagonal" as never)
        ).toBe(false);
        expect(state.store[EDITOR_LAYOUT_MODE_KEY]).toBeUndefined();
    });

    it("writes through undefined to clear the record", async () => {
        const state = makeFake({ [EDITOR_LAYOUT_MODE_KEY]: "max-even" });
        expect(await writeLayoutMode(state, undefined)).toBe(true);
        expect(state.store[EDITOR_LAYOUT_MODE_KEY]).toBeUndefined();
    });

    it("never persists a grid shape alongside the mode", async () => {
        const state = makeFake();
        await writeLayoutMode(state, "max-even");
        expect(Object.keys(state.store)).toEqual([EDITOR_LAYOUT_MODE_KEY]);
    });

    it("leaves unrelated workspace state alone", async () => {
        const state = makeFake({
            "superset.activeViewId": "superset.todo",
            "superset.cachedEntry": { x: 1 },
        });
        await writeLayoutMode(state, "even-max");
        expect(state.store["superset.activeViewId"]).toBe("superset.todo");
        expect(state.store["superset.cachedEntry"]).toEqual({ x: 1 });
    });
});
