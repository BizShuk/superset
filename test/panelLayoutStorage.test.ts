// panelLayoutStorage — pure storage helpers for panel-layout
// persistence. The unit tests exercise the read/write/sanitize
// primitives directly, without touching vscode.

import { describe, it, expect } from "vitest";
import {
    ACTIVE_VIEW_KEY,
    TRACKED_VIEW_IDS,
    readActiveViewId,
    sanitizeViewId,
    writeActiveViewId,
} from "../src/panelLayout/layoutStorage";

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

describe("TRACKED_VIEW_IDS", () => {
    it("covers the six registered panels", () => {
        // Mirrors `views` entries in package.json — both view
        // containers (`superset` and `superset-overall`) covered.
        expect(TRACKED_VIEW_IDS).toEqual([
            "superset.terminals",
            "superset.mdns",
            "superset.topology",
            "superset.todo",
            "superset.workspaceTodo",
            "superset.projectsTodo",
        ]);
    });
});

describe("sanitizeViewId", () => {
    it("accepts each tracked viewId verbatim", () => {
        for (const id of TRACKED_VIEW_IDS) {
            expect(sanitizeViewId(id)).toBe(id);
        }
    });

    it("rejects unknown strings", () => {
        expect(sanitizeViewId("superset.unregistered")).toBeUndefined();
        expect(sanitizeViewId("workbench.explorer")).toBeUndefined();
    });

    it("rejects non-string inputs", () => {
        expect(sanitizeViewId(undefined)).toBeUndefined();
        expect(sanitizeViewId(null)).toBeUndefined();
        expect(sanitizeViewId(42)).toBeUndefined();
        expect(sanitizeViewId({ id: "superset.todo" })).toBeUndefined();
    });

    it("rejects empty strings", () => {
        expect(sanitizeViewId("")).toBeUndefined();
    });

    it("rejects lookalikes with different casing", () => {
        // Tracked IDs are lower-case prefix-strict; "Superset.todo"
        // would be a programming error from a consumer.
        expect(sanitizeViewId("Superset.todo")).toBeUndefined();
    });
});

describe("readActiveViewId", () => {
    it("returns undefined when no record exists", () => {
        const state = makeFake();
        expect(readActiveViewId(state)).toBeUndefined();
    });

    it("returns the stored viewId when valid", () => {
        const state = makeFake({ [ACTIVE_VIEW_KEY]: "superset.mdns" });
        expect(readActiveViewId(state)).toBe("superset.mdns");
    });

    it("returns undefined when the stored value is junk", () => {
        const state = makeFake({ [ACTIVE_VIEW_KEY]: "superset.removed" });
        expect(readActiveViewId(state)).toBeUndefined();
    });

    it("returns undefined when the stored value is not a string", () => {
        const state = makeFake({ [ACTIVE_VIEW_KEY]: { bogus: true } });
        expect(readActiveViewId(state)).toBeUndefined();
    });
});

describe("writeActiveViewId", () => {
    it("writes a valid viewId and returns true", async () => {
        const state = makeFake();
        const ok = await writeActiveViewId(state, "superset.todo");
        expect(ok).toBe(true);
        expect(state.store[ACTIVE_VIEW_KEY]).toBe("superset.todo");
    });

    it("rejects unknown viewId and returns false (no write)", async () => {
        const state = makeFake();
        const ok = await writeActiveViewId(state, "superset.unregistered");
        expect(ok).toBe(false);
        expect(state.store[ACTIVE_VIEW_KEY]).toBeUndefined();
    });

    it("writes through undefined to clear the record", async () => {
        const state = makeFake({ [ACTIVE_VIEW_KEY]: "superset.todo" });
        const ok = await writeActiveViewId(state, undefined);
        expect(ok).toBe(true);
        expect(state.store[ACTIVE_VIEW_KEY]).toBeUndefined();
    });

    it("preserves any other unrelated keys in state", async () => {
        const state = makeFake({
            "superset.auditLog": ["entry-1"],
            "superset.cachedEntry": { x: 1 },
        });
        await writeActiveViewId(state, "superset.terminals");
        expect(state.store["superset.auditLog"]).toEqual(["entry-1"]);
        expect(state.store["superset.cachedEntry"]).toEqual({ x: 1 });
        expect(state.store[ACTIVE_VIEW_KEY]).toBe("superset.terminals");
    });
});