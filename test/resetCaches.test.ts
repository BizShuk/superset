import { describe, it, expect } from "vitest";
import { collectSupersetKeys } from "../src/resetCaches";

describe("collectSupersetKeys", () => {
    it("returns only keys starting with 'superset.'", () => {
        const state = {
            keys: () => [
                "superset.auditLevel",
                "superset.panelLayout",
                "workbench.panel.defaultLocation",
                "typescript.tsdk",
            ],
        } as any;
        expect(collectSupersetKeys(state)).toEqual([
            "superset.auditLevel",
            "superset.panelLayout",
        ]);
    });

    it("returns empty array when no keys match", () => {
        const state = {
            keys: () => [
                "workbench.panel.defaultLocation",
                "typescript.tsdk",
            ],
        } as any;
        expect(collectSupersetKeys(state)).toEqual([]);
    });
});
