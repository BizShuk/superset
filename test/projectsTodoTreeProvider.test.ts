import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProjectsTodoTreeProvider } from "../src/projectsTodo/projectsTodoTreeProvider";
import { ProjectsTodoStore } from "../src/projectsTodo/projectsTodoStore";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as os from "os";

// Mock vscode namespace
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
    class RelativePattern {
        constructor(public base: unknown, public pattern: string) {}
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
        RelativePattern,
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

describe("ProjectsTodoTreeProvider", () => {
    let tempDir: string;
    let store: ProjectsTodoStore;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), "superset-prov-test-"));
        vi.mocked(os.homedir).mockReturnValue(tempDir);

        // Create mock folders and todo lists
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        const p1 = join(projectsDir, "cc-plugin");
        mkdirSync(p1);
        writeFileSync(join(p1, "README.todo"), "# TODO\n- [ ] Task 1\n- [x] Task 2\n");

        const p2 = join(projectsDir, "env-setup");
        mkdirSync(p2);
        writeFileSync(join(p2, "README.todo"), "# TODO\n- [ ] Task 3\n");

        store = new ProjectsTodoStore();
        await store.load();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("returns correct project list as root items", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        expect(roots).toHaveLength(2);
        // Project folders should be sorted alphabetically
        expect(roots![0].text).toBe("cc-plugin");
        expect(roots![1].text).toBe("env-setup");

        // The roots should represent projects with folder kind
        expect(roots![0].line).toBe(-1);
        expect(roots![0].projectPath).toBeDefined();
    });

    it("filters completed tasks by default", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        // Get children of "cc-plugin"
        const children = await provider.getChildren(roots![0]);
        // Default section should be the child
        expect(children).toHaveLength(1);
        expect(children![0].text).toBe("Default");

        const tasks = await provider.getChildren(children![0]);
        // By default, completed tasks (Task 2) should be filtered out
        expect(tasks).toHaveLength(1);
        expect(tasks![0].text).toBe("Task 1");
        expect(tasks![0].checked).toBe(false);
    });

    it("shows completed tasks when toggled", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        provider.toggleShowCompleted();

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots![0]);
        const tasks = await provider.getChildren(children![0]);

        // Now both Task 1 (pending) and Task 2 (completed) should be returned
        expect(tasks).toHaveLength(2);
        expect(tasks[0].text).toBe("Task 1");
        expect(tasks[1].text).toBe("Task 2");
    });

    it("filters priority tasks when priority filter is active", async () => {
        const p1 = join(tempDir, "projects", "cc-plugin");
        writeFileSync(join(p1, "README.todo"), "# TODO\n- [ ] [P0] Task P0\n- [ ] [P1] Task P1\n- [ ] Task normal\n");
        await store.load();

        const provider = new ProjectsTodoTreeProvider(store);
        provider.togglePriorityFilter("P0");

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots![0]);
        const tasks = await provider.getChildren(children![0]);

        // Only P0 task should be shown
        expect(tasks).toHaveLength(1);
        expect(tasks![0].text).toBe("[P0] Task P0");
    });

    it("renders folder item for project nodes and tags for sections in getTreeItem", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        const item = provider.getTreeItem(roots![0]);
        expect(item.label).toBe("cc-plugin");
        expect(item.contextValue).toBe("projectsTodoProject");
        expect(item.collapsibleState).toBe(2); // Expanded
    });

    it("shows pending count badge for section rows in getTreeItem", async () => {
        const p = join(tempDir, "projects", "cc-plugin");
        writeFileSync(
            join(p, "README.todo"),
            "## Foo\n- [ ] a\n- [ ] b\n- [x] c\n"
        );
        await store.load();

        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();
        const section = (await provider.getChildren(roots![0]))![0];
        expect(section.text).toBe("Foo");

        const item = provider.getTreeItem(section);
        expect(item.label).toBe("Foo");
        expect(item.contextValue).toBe("projectsTodoSectionArchivable");
        expect(item.description).toBe("2 ◐");
    });

    it("shows 0 pending badge for section with only completed items", async () => {
        const p = join(tempDir, "projects", "cc-plugin");
        // Use toggleShowCompleted so the all-[x] section survives the
        // filter (otherwise `filterItem` would drop a section whose
        // children are all completed). With the filter relaxed, both
        // completed items stay visible but contribute 0 to the pending
        // count, exercising the `0 ◐` path.
        writeFileSync(
            join(p, "README.todo"),
            "## Done\n- [x] a\n- [x] b\n"
        );
        await store.load();

        const provider = new ProjectsTodoTreeProvider(store);
        provider.toggleShowCompleted();
        const roots = await provider.getChildren();
        const section = (await provider.getChildren(roots![0]))![0];
        expect(section.text).toBe("Done");

        const item = provider.getTreeItem(section);
        expect(item.description).toBe("0 ◐");
    });

    it("hides pending badge for archive subsection rows", async () => {
        const p = join(tempDir, "projects", "cc-plugin");
        // Hide-completed is on by default and `filterItem` drops
        // archive subtrees (## Archive itself and ### Old) entirely.
        // The archive row therefore never reaches `getTreeItem` in
        // that mode. To exercise the "no badge for archive" rule we
        // need a setup where the archive row IS rendered, which means
        // toggling showCompleted on so the archive subtree survives.
        // We also give `### Old` one pending child so it isn't pruned
        // as fully-completed.
        writeFileSync(
            join(p, "README.todo"),
            [
                "## Active",
                "- [ ] a",
                "## Archive",
                "### Old",
                "- [ ] still",
            ].join("\n")
        );
        await store.load();

        const provider = new ProjectsTodoTreeProvider(store);
        provider.toggleShowCompleted();
        const roots = await provider.getChildren();
        const sections = await provider.getChildren(roots![0]);

        const active = sections.find((s) => s.text === "Active")!;
        const archive = sections.find((s) => s.text === "Old")!;

        const activeItem = provider.getTreeItem(active);
        expect(activeItem.contextValue).toBe("projectsTodoSectionArchivable");
        expect(activeItem.description).toBe("1 ◐");

        const archiveItem = provider.getTreeItem(archive);
        expect(archiveItem.contextValue).toBe("projectsTodoSectionArchived");
        expect(archiveItem.description).toBeUndefined();
    });

    it("lists project whose tasks are all completed (default hide-completed mode)", async () => {
        const p = join(tempDir, "projects", "cc-plugin");
        writeFileSync(
            join(p, "README.todo"),
            "# TODO\n- [x] finished\n- [x] also finished\n"
        );
        // env-setup still has its pending Task 3, so the root list
        // should contain both projects even though cc-plugin would
        // have been hidden by the old gate.
        await store.load();

        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        expect(roots).toHaveLength(2);
        const cc = roots!.find((r) => r.text === "cc-plugin")!;
        expect(cc).toBeDefined();
        // All-completed project has no surviving children under
        // hide-completed mode, so the row should report 0 pending.
        expect(cc.children).toEqual([]);
        const item = provider.getTreeItem(cc);
        expect(item.description).toBe("0 pending");
        // Empty filtered children → collapsed, not expanded into nothing.
        expect(item.collapsibleState).toBe(1); // Collapsed
    });

    it("lists project whose README.todo is empty", async () => {
        const p = join(tempDir, "projects", "cc-plugin");
        writeFileSync(join(p, "README.todo"), "# TODO\n");
        await store.load();

        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        expect(roots).toHaveLength(2);
        const cc = roots!.find((r) => r.text === "cc-plugin")!;
        expect(cc.children).toEqual([]);
        const item = provider.getTreeItem(cc);
        expect(item.description).toBe("0 pending");
        expect(item.collapsibleState).toBe(1); // Collapsed
    });

    it("lists project even when active priority filter excludes every task", async () => {
        const p = join(tempDir, "projects", "cc-plugin");
        // cc-plugin has only P1 + no-priority tasks; env-setup has a
        // plain pending task. With P0 filter on, cc-plugin's children
        // collapse to empty, but the project must still appear.
        writeFileSync(
            join(p, "README.todo"),
            "# TODO\n- [ ] [P1] only P1\n- [ ] plain\n"
        );
        await store.load();

        const provider = new ProjectsTodoTreeProvider(store);
        provider.togglePriorityFilter("P0");

        const roots = await provider.getChildren();
        expect(roots).toHaveLength(2);
        const cc = roots!.find((r) => r.text === "cc-plugin")!;
        expect(cc.children).toEqual([]);
        const item = provider.getTreeItem(cc);
        expect(item.description).toBe("0 pending");
        expect(item.collapsibleState).toBe(1); // Collapsed
    });

    it("expands project node when filtered children exist", async () => {
        // Sanity-check the inverse of the collapsed case: when at least
        // one child survives the filter, the project node stays Expanded.
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        // env-setup has a pending task in the default setup, so it has
        // a filtered child and should render Expanded.
        const env = roots!.find((r) => r.text === "env-setup")!;
        expect(env.children!.length).toBeGreaterThan(0);
        const item = provider.getTreeItem(env);
        expect(item.collapsibleState).toBe(2); // Expanded
        expect(item.description).toBe("1 pending");
    });
});

describe("ProjectsTodoTreeProvider — workspace plans row", () => {
    let tempDir: string;
    let store: ProjectsTodoStore;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), "superset-prov-plans-"));
        vi.mocked(os.homedir).mockReturnValue(tempDir);

        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        // Project A: README.todo + plans  ── 應貢獻 plan
        const a = join(projectsDir, "alpha");
        mkdirSync(a);
        writeFileSync(join(a, "README.todo"), "# TODO\n- [ ] A\n");
        mkdirSync(join(a, "plans"));
        writeFileSync(join(a, "plans", "2026-07-01-a.md"), "# Plan A\n");

        // Project B (under tmp): README.todo + plans  ── 應貢獻 plan
        mkdirSync(join(projectsDir, "tmp"));
        const b = join(projectsDir, "tmp", "beta");
        mkdirSync(b);
        writeFileSync(join(b, "README.todo"), "# TODO\n- [ ] B\n");
        mkdirSync(join(b, "plans"));
        writeFileSync(join(b, "plans", "2026-07-02-b.md"), "# Plan B\n");

        // playground/exp: README.todo + plans  ── 不應貢獻 plan (one-layer 邊界)
        const p = join(projectsDir, "playground", "exp");
        mkdirSync(p, { recursive: true });
        writeFileSync(join(p, "README.todo"), "# TODO\n- [ ] P\n");
        mkdirSync(join(p, "plans"));
        writeFileSync(join(p, "plans", "2026-07-03-p.md"), "# Plan P\n");

        store = new ProjectsTodoStore();
        await store.load();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("renders a top-level 'Plans' row when workspace plans exist", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        // 3 projects (alpha, beta, exp) + 1 top-level Plans row
        const plansRow = roots!.find((r) => r.text === "Plans" && r.kind === "section");
        expect(plansRow).toBeDefined();
        // The row is not a project node: projectPath placeholder, no projectName match
        expect(plansRow!.projectPath).toBe("");
        expect(plansRow!.level).toBeUndefined(); // virtual section, same as parser "Default"
    });

    it("Plans row children are flat list of plans from projects/ and projects/tmp/ (not deeper)", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();
        const plansRow = roots!.find((r) => r.text === "Plans" && r.kind === "section")!;
        const plans = plansRow.children!;

        // Only alpha and beta contribute; playground/exp is two layers deep.
        expect(plans).toHaveLength(2);
        // Row text is the H1 title (human-readable); filename lives in
        // `description` for at-a-glance reference (see plansSource.ts).
        const titles = plans.map((p) => p.text).sort();
        expect(titles).toEqual(["Plan A", "Plan B"]);
        const basenames = plans.map((p) => p.description).sort();
        expect(basenames).toEqual(["2026-07-01-a", "2026-07-02-b"]);

        // Each plan carries its own projectName / projectPath for inline open
        const byName = new Map(plans.map((p) => [p.text, p]));
        expect(byName.get("Plan A")!.projectName).toBe("alpha");
        expect(byName.get("Plan B")!.projectName).toBe("beta");
    });

    it("Plans row is omitted when no workspace plans exist", async () => {
        // Fresh store with no plans fixtures
        const emptyDir = mkdtempSync(join(tmpdir(), "superset-prov-empty-"));
        try {
            vi.mocked(os.homedir).mockReturnValue(emptyDir);
            mkdirSync(join(emptyDir, "projects"));
            const only = join(emptyDir, "projects", "only");
            mkdirSync(only);
            writeFileSync(join(only, "README.todo"), "# TODO\n- [ ] x\n");
            const emptyStore = new ProjectsTodoStore();
            await emptyStore.load();
            const provider = new ProjectsTodoTreeProvider(emptyStore);
            const roots = await provider.getChildren();
            expect(roots!.find((r) => r.text === "Plans" && r.kind === "section")).toBeUndefined();
        } finally {
            rmSync(emptyDir, { recursive: true, force: true });
        }
    });
});
