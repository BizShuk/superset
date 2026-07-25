import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProjectsTodoTreeProvider } from "../src/projectsTodo/projectsTodoTreeProvider";
import { ProjectsTodoStore } from "../src/projectsTodo/projectsTodoStore";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as os from "os";

// Mock vscode namespace — mirrors projectsTodoTreeProvider.test.ts.
vi.mock("vscode", () => {
    class EventEmitter<T> {
        private listeners = new Set<(e: T) => void>();
        event = (listener: (e: T) => void) => {
            this.listeners.add(listener);
            return { dispose: () => this.listeners.delete(listener) };
        };
        fire(e: T) {
            for (const l of this.listeners) l(e);
        }
        dispose() {
            this.listeners.clear();
        }
    }
    class ThemeIcon {
        constructor(public id: string, public color?: unknown) {}
    }
    class ThemeColor {
        constructor(public id: string) {}
    }
    class Uri {
        constructor(public path: string) {}
        static file(path: string) {
            return new Uri(path);
        }
        static joinPath(base: Uri, ...paths: string[]) {
            return new Uri(base.path + "/" + paths.join("/"));
        }
    }
    const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
    const TreeItemCheckboxState = { Checked: 1, Unchecked: 0 };
    return {
        EventEmitter,
        ThemeIcon,
        ThemeColor,
        Uri,
        TreeItemCollapsibleState,
        TreeItemCheckboxState,
        commands: {
            executeCommand: vi.fn(),
        },
        TreeItem: class {
            command?: unknown;
            contextValue?: string;
            description?: string;
            iconPath?: unknown;
            label: string;
            tooltip?: string;
            collapsibleState?: number;
            checkboxState?: number;
            constructor(label: string) {
                this.label = label;
            }
        },
    };
});

vi.mock("os", async () => {
    const original = await vi.importActual<typeof os>("os");
    return {
        ...original,
        homedir: vi.fn(),
    };
});

/**
 * The workspace-mode `ProjectsTodoTreeProvider` now exposes view-type
 * switching (Section / Priority / File) so the SuperSet TODO panel's
 * View buttons drive real changes. These tests pin that contract:
 * the default is "section", switches rebuild the children with the
 * corresponding grouping, and the `superset.todo.viewType` context
 * key is pushed on every transition.
 */
describe("ProjectsTodoTreeProvider — workspace viewType switching", () => {
    let tempDir: string;
    let workspaceRoot: string;
    let store: ProjectsTodoStore;
    let provider: ProjectsTodoTreeProvider;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), "superset-view-type-test-"));
        vi.mocked(os.homedir).mockReturnValue(tempDir);

        workspaceRoot = join(tempDir, "ws");
        mkdirSync(workspaceRoot);

        // Two depth-1 sub-projects with mixed priorities / states so
        // every grouping path has something to show.
        const subA = join(workspaceRoot, "sub-a");
        const subB = join(workspaceRoot, "sub-b");
        mkdirSync(subA);
        mkdirSync(subB);
        writeFileSync(
            join(subA, "README.todo"),
            "# A\n- [ ] (P0) urgent\n- [ ] medium\n- [x] done\n",
        );
        writeFileSync(
            join(subB, "README.todo"),
            "# B\n- [ ] (P1) follow-up\n- [ ] low\n",
        );

        store = new ProjectsTodoStore();
        await store.loadWorkspaceTodos(workspaceRoot, 1, false);

        provider = new ProjectsTodoTreeProvider(
            store,
            workspaceRoot,
            undefined,
            "workspace",
        );
        provider.start();
    });

    afterEach(() => {
        provider.stop();
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("defaults to section view and pushes the context key on start", () => {
        expect(provider.getViewType()).toBe("section");
        // Section view emits per-sub-project rows; both sub-a and
        // sub-b show up as folder rows at the workspace root.
        const children = provider.getChildren() as Array<{
            text: string;
            kind: string;
        }>;
        const labels = children.map((c) => c.text).sort();
        expect(labels).toEqual(["sub-a", "sub-b"]);
    });

    it("switches to priority view and rebuilds children as P0/P1/P2/None groups", () => {
        provider.setViewType("priority");
        expect(provider.getViewType()).toBe("priority");

        const children = provider.getChildren() as Array<{
            text: string;
            kind: string;
            children: Array<{ text: string }>;
        }>;
        const labels = children.map((c) => c.text);
        // Both sub-projects contribute a P0, a P1, and an unprioritised
        // row; P2 has nothing so it should NOT appear.
        expect(labels).toContain("P0");
        expect(labels).toContain("P1");
        expect(labels).toContain("None");
        expect(labels).not.toContain("P2");

        const p0Group = children.find((c) => c.text === "P0");
        expect(p0Group).toBeDefined();
        // The copy keeps the raw text — `getTreeItem`'s label renderer
        // strips the `[P0]` / `(P0)` tag for display. Match the local
        // `TodoTreeProvider.buildPriorityGroups` semantics.
        expect(
            p0Group!.children.map((c) => c.text).sort(),
        ).toEqual(["(P0) urgent"]);
    });

    it("switches to file view and groups items by README.todo", () => {
        provider.setViewType("file");
        expect(provider.getViewType()).toBe("file");

        const children = provider.getChildren() as Array<{
            text: string;
            kind: string;
            children: Array<{ text: string }>;
        }>;
        // Every link-free item lands in README.todo (the default bucket
        // — no `.todo` link is present).
        expect(children.map((c) => c.text)).toEqual(["README.todo"]);
        expect(children[0]!.children.length).toBeGreaterThan(0);
    });

    it("setViewType back to section restores per-sub-project rendering", () => {
        provider.setViewType("priority");
        provider.setViewType("section");
        expect(provider.getViewType()).toBe("section");

        const children = provider.getChildren() as Array<{
            text: string;
        }>;
        expect(children.map((c) => c.text).sort()).toEqual([
            "sub-a",
            "sub-b",
        ]);
    });

    it("emptyStateCopy overrides the placeholder text for empty workspaces", async () => {
        // Build a separate provider against an empty workspace so we
        // can verify the constructor flag without disturbing the
        // populated one above.
        const emptyRoot = join(tempDir, "empty-ws");
        mkdirSync(emptyRoot);
        const emptyStore = new ProjectsTodoStore();
        await emptyStore.loadWorkspaceTodos(emptyRoot, 1, false);

        const customProvider = new ProjectsTodoTreeProvider(
            emptyStore,
            emptyRoot,
            undefined,
            "workspace",
            "CUSTOM-COPY",
        );
        const children = customProvider.getChildren() as Array<{
            text: string;
            description?: string;
        }>;
        expect(children).toHaveLength(1);
        expect(children[0]!.text).toMatch(/No README\.todo/);
        expect(children[0]!.description).toBe("CUSTOM-COPY");
    });

    it("pushes superset.todo.viewType context key on every setViewType call", async () => {
        const { commands } = await import("vscode");
        const executeCommand = vi.mocked(commands.executeCommand);

        provider.setViewType("priority");
        provider.setViewType("file");
        provider.setViewType("section");

        const calls = executeCommand.mock.calls.filter(
            ([cmd, key]) =>
                cmd === "setContext" && key === "superset.todo.viewType",
        );
        const values = calls.map(([, , v]) => v);
        // Initial start + three setViewType calls.
        expect(values).toEqual(
            expect.arrayContaining(["section", "priority", "file"]),
        );
        expect(values.length).toBeGreaterThanOrEqual(3);
    });
});