import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProjectsTodoTreeProvider } from "../src/projectsTodo/projectsTodoTreeProvider";
import { ProjectsTodoStore } from "../src/projectsTodo/projectsTodoStore";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock vscode namespace — minimal set used by the provider.
vi.mock("vscode", () => {
    class EventEmitter<T> {
        private listeners = new Set<(e: T) => void>();
        event = (listener: (e: T) => void) => {
            this.listeners.add(listener);
            return { dispose: () => this.listeners.delete(listener) };
        };
        fire(e: T) { for (const l of this.listeners) l(e); }
        dispose() { this.listeners.clear(); }
    }
    class ThemeIcon { constructor(public id: string) {} }
    class ThemeColor { constructor(public id: string) {} }
    class Uri {
        constructor(public path: string) {}
        static file(p: string) { return new Uri(p); }
        static joinPath(b: Uri, ...ps: string[]) { return new Uri(b.path + "/" + ps.join("/")); }
    }
    const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
    const TreeItemCheckboxState = { Checked: 1, Unchecked: 0 };
    return {
        EventEmitter, ThemeIcon, ThemeColor, Uri, TreeItemCollapsibleState, TreeItemCheckboxState,
        commands: { executeCommand: vi.fn() },
        TreeItem: class {
            label: string;
            description?: string;
            constructor(l: string) { this.label = l; }
        },
    };
});

/**
 * The SuperSet TODO panel passes a custom `emptyStateCopy` to the
 * workspace-mode provider so the placeholder copy matches the
 * depth-1 contract ("drop one into a folder"). The legacy `Workspace
 * TODO` panel does not pass anything and falls back to the original
 * wording. These tests pin both branches so the rewrite of
 * `src/todo/index.ts` doesn't drift the placeholder text.
 */
describe("ProjectsTodoTreeProvider — empty-state copy", () => {
    let tempDir: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), "superset-empty-state-test-"));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("uses the default placeholder copy when no emptyStateCopy is supplied", async () => {
        const ws = join(tempDir, "ws");
        mkdirSync(ws);
        const store = new ProjectsTodoStore();
        await store.loadWorkspaceTodos(ws, 1, false);

        const provider = new ProjectsTodoTreeProvider(
            store,
            ws,
            undefined,
            "workspace",
        );
        const children = provider.getChildren() as Array<{
            text: string;
            description?: string;
            kind: string;
        }>;
        expect(children).toHaveLength(1);
        expect(children[0]!.text).toBe(
            "No README.todo files in this workspace",
        );
        expect(children[0]!.description).toBe(
            "Drop a README.todo into a subdirectory to add it here",
        );
    });

    it("uses the panel-supplied copy when emptyStateCopy is provided", async () => {
        const ws = join(tempDir, "ws");
        mkdirSync(ws);
        const store = new ProjectsTodoStore();
        await store.loadWorkspaceTodos(ws, 1, false);

        const provider = new ProjectsTodoTreeProvider(
            store,
            ws,
            undefined,
            "workspace",
            "Drop a README.todo into a folder to see it here.",
        );
        const children = provider.getChildren() as Array<{
            text: string;
            description?: string;
        }>;
        expect(children).toHaveLength(1);
        expect(children[0]!.text).toBe(
            "No README.todo files in this workspace",
        );
        expect(children[0]!.description).toBe(
            "Drop a README.todo into a folder to see it here.",
        );
    });

    it("returns an empty array when workspaceRoot is missing (workspace mode, no root)", () => {
        // Build a provider without a workspaceRoot (edge case the
        // `src/todo/index.ts` flow always avoids, but the contract
        // explicitly short-circuits in this branch).
        const store = new ProjectsTodoStore();
        const provider = new ProjectsTodoTreeProvider(
            store,
            undefined,
            undefined,
            "workspace",
        );
        expect(provider.getChildren()).toEqual([]);
    });
});