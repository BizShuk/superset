import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProjectsTodoTreeProvider } from "../src/projectsTodo/projectsTodoTreeProvider";
import { ProjectsTodoStore } from "../src/projectsTodo/projectsTodoStore";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join, basename } from "path";
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

    it("groups a nested README.todo by the folder name where it was found", async () => {
        const nested = join(tempDir, "projects", "platform", "apps", "server");
        mkdirSync(nested, { recursive: true });
        writeFileSync(join(nested, "README.todo"), "# TODO\n- [ ] nested task\n");
        await store.load();

        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();
        const server = roots!.find((root) => root.projectPath === nested);

        expect(server).toBeDefined();
        expect(server!.text).toBe("server");
        expect(provider.getTreeItem(server!).tooltip).toBe(nested);
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
        // Project rows default to Collapsed so the overview shows a
        // flat project list at start; users expand the ones they care
        // about. Auto-expansion was removed in 0.10.x.
        expect(item.collapsibleState).toBe(1); // Collapsed
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

    it("keeps project node Collapsed even when filtered children exist", async () => {
        // Sanity-check the new default: the project row stays Collapsed
        // regardless of how many children the filter leaves — auto-
        // expansion was removed in 0.10.x so the overview renders as a
        // flat project list at start.
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        // env-setup has a pending task in the default setup, so it has
        // a filtered child. The row must STILL be Collapsed.
        const env = roots!.find((r) => r.text === "env-setup")!;
        expect(env.children!.length).toBeGreaterThan(0);
        const item = provider.getTreeItem(env);
        expect(item.collapsibleState).toBe(1); // Collapsed
        expect(item.description).toBe("1 pending");
    });
});

describe("ProjectsTodoTreeProvider — no top-level plans row", () => {
    let tempDir: string;
    let store: ProjectsTodoStore;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), "superset-prov-plans-"));
        vi.mocked(os.homedir).mockReturnValue(tempDir);

        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        // alpha: 有 plan (但不會出現在 top-level row — 已廢除)
        const a = join(projectsDir, "alpha");
        mkdirSync(a);
        writeFileSync(join(a, "README.todo"), "# TODO\n- [ ] A\n");
        mkdirSync(join(a, "plans"));
        writeFileSync(join(a, "plans", "2026-07-01-a.md"), "# Plan A\n");

        // beta (under tmp): 有 plan
        mkdirSync(join(projectsDir, "tmp"));
        const b = join(projectsDir, "tmp", "beta");
        mkdirSync(b);
        writeFileSync(join(b, "README.todo"), "# TODO\n- [ ] B\n");
        mkdirSync(join(b, "plans"));
        writeFileSync(join(b, "plans", "2026-07-02-b.md"), "# Plan B\n");

        store = new ProjectsTodoStore();
        await store.load();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("does NOT render a top-level 'Plans' row even when workspace plans exist", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        // Top-level merged row was removed in 0.10.x — workspace plans
        // only appear as per-project sub-sections. Scan every root for
        // the synthetic 'Plans' marker to confirm it's gone.
        const topLevelPlans = roots!.find(
            (r) =>
                r.text === "Plans" &&
                r.kind === "section" &&
                r.projectPath === ""
        );
        expect(topLevelPlans).toBeUndefined();
    });

    it("plans still surface under each project's own row", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();
        const alpha = roots!.find((r) => r.text === "alpha")!;
        const beta = roots!.find((r) => r.text === "beta")!;

        const alphaPlans = alpha.children!.find((c) => c.text === "Plans");
        expect(alphaPlans).toBeDefined();
        expect(alphaPlans!.children!.map((p) => p.text)).toEqual(["Plan A"]);

        const betaPlans = beta.children!.find((c) => c.text === "Plans");
        expect(betaPlans).toBeDefined();
        expect(betaPlans!.children!.map((p) => p.text)).toEqual(["Plan B"]);
    });
});

describe("ProjectsTodoTreeProvider — per-project plans sub-section", () => {
    let tempDir: string;
    let store: ProjectsTodoStore;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), "superset-prov-perproj-"));
        vi.mocked(os.homedir).mockReturnValue(tempDir);

        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        // alpha: README.todo item + plan  ── 應有 [Default, Plans]
        const a = join(projectsDir, "alpha");
        mkdirSync(a);
        writeFileSync(join(a, "README.todo"), "# TODO\n- [ ] alpha-task\n");
        mkdirSync(join(a, "plans"));
        writeFileSync(join(a, "plans", "2026-07-01-a.md"), "# Plan A\n");

        // gamma: README.todo 但 plan filter 下無可見項目 + 有 plan
        // ── 應只剩 [Plans]
        const g = join(projectsDir, "gamma");
        mkdirSync(g);
        writeFileSync(join(g, "README.todo"), "# TODO\n- [x] done\n");
        mkdirSync(join(g, "plans"));
        writeFileSync(join(g, "plans", "2026-07-04-g.md"), "# Plan G\n");

        // delta: README.todo 但完全沒有 plans  ── 不應有 Plans sub-section
        const d = join(projectsDir, "delta");
        mkdirSync(d);
        writeFileSync(join(d, "README.todo"), "# TODO\n- [ ] delta-task\n");

        store = new ProjectsTodoStore();
        await store.load();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("appends a synthetic 'Plans' sub-section after README.todo sections when a project has plans", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        // alpha's row should be present
        const alpha = roots!.find((r) => r.text === "alpha" && r.kind === "section")!;
        expect(alpha).toBeDefined();

        // alpha's children = [Default (alpha-task), Plans (Plan A)]
        expect(alpha.children).toBeDefined();
        expect(alpha.children).toHaveLength(2);
        expect(alpha.children![0].text).toBe("Default");
        expect(alpha.children![1].text).toBe("Plans");
        expect(alpha.children![1].kind).toBe("section");

        // The per-project Plans section carries its own plans
        const plansSection = alpha.children![1];
        expect(plansSection.children).toBeDefined();
        expect(plansSection.children).toHaveLength(1);
        expect(plansSection.children![0].kind).toBe("plan");
        expect(plansSection.children![0].text).toBe("Plan A");
        expect(plansSection.children![0].filePath).toBe(
            join(alpha.projectPath, "plans", "2026-07-01-a.md"),
        );
    });

    it("renders the per-project Plans sub-section as Expanded with '1 plan' badge", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();
        const alpha = roots!.find((r) => r.text === "alpha")!;
        const plansSection = alpha.children!.find((c) => c.text === "Plans")!;

        const item = provider.getTreeItem(plansSection);
        expect(item.contextValue).toBe("projectsTodoPlansSection");
        expect(item.collapsibleState).toBe(2); // Expanded
        expect(item.description).toBe("1 plan");
    });

    it("survives the hide-completed filter (project with only completed README.todo + plans shows Plans section only)", async () => {
        // gamma's README.todo is all-completed; under default
        // hide-completed mode, the README.todo contributes zero
        // children but the Plans section still surfaces.
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        const gamma = roots!.find((r) => r.text === "gamma")!;
        expect(gamma.children).toHaveLength(1);
        expect(gamma.children![0].text).toBe("Plans");
        expect(gamma.children![0].children).toHaveLength(1);
        expect(gamma.children![0].children![0].text).toBe("Plan G");

        // gamma's row stays Collapsed even though the Plans section survives
        // the filter (no checked state to hide). Auto-expansion was
        // removed in 0.10.x — users expand project rows on demand.
        const item = provider.getTreeItem(gamma);
        expect(item.collapsibleState).toBe(1); // Collapsed
        // "0 pending" because Plan G is not a checkbox — countPending
        // ignores kind !== "checkbox".
        expect(item.description).toBe("0 pending");
    });

    it("does NOT attach a Plans sub-section to projects without plans", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        const delta = roots!.find((r) => r.text === "delta")!;
        expect(delta.children).toHaveLength(1);
        expect(delta.children![0].text).toBe("Default");
        expect(delta.children!.find((c) => c.text === "Plans")).toBeUndefined();
    });

    it("per-project plan items carry projectName + projectPath for inline openProject", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();
        const alpha = roots!.find((r) => r.text === "alpha")!;
        const planItem = alpha.children![1].children![0];

        expect(planItem.projectName).toBe("alpha");
        expect(planItem.projectPath).toBe(alpha.projectPath);
    });

    it("per-project plan items respect the priority filter passthrough (plans survive any priority filter)", async () => {
        // Toggle P0 — neither alpha-task nor Plan A has a P0 tag, but
        // the plan item must still appear under alpha's Plans sub-section
        // because applyPriorityFilter lets kind === "plan" items through.
        const provider = new ProjectsTodoTreeProvider(store);
        provider.togglePriorityFilter("P0");

        const roots = await provider.getChildren();
        const alpha = roots!.find((r) => r.text === "alpha")!;
        // README.todo task has no P tag → filtered out, so only the
        // Plans sub-section survives under alpha.
        expect(alpha.children).toHaveLength(1);
        expect(alpha.children![0].text).toBe("Plans");
        expect(alpha.children![0].children).toHaveLength(1);
        expect(alpha.children![0].children![0].text).toBe("Plan A");
    });

    it("top-level 'Plans' row no longer aggregates plans (only per-project sub-sections remain)", async () => {
        const provider = new ProjectsTodoTreeProvider(store);
        const roots = await provider.getChildren();

        // Top-level merged row was removed in 0.10.x. Plans now only
        // surface under each project's own row.
        const topLevelPlans = roots!.find(
            (r) =>
                r.text === "Plans" &&
                r.kind === "section" &&
                r.projectPath === ""
        );
        expect(topLevelPlans).toBeUndefined();

        // Per-project sub-sections still carry the plans.
        const alpha = roots!.find((r) => r.text === "alpha")!;
        const gamma = roots!.find((r) => r.text === "gamma")!;
        expect(alpha.children!.find((c) => c.text === "Plans")!.children).toHaveLength(1);
        expect(gamma.children!.find((c) => c.text === "Plans")!.children).toHaveLength(1);
    });

    it("does NOT duplicate the per-project Plans sub-section after toggling showCompleted on/off", async () => {
        // Regression for the showCompleted ? raw : filterCompleted(raw)
        // aliasing bug: when showCompleted === true, completedFiltered
        // shared the store's items reference, and applyPriorityFilter's
        // empty-set short-circuit returned the same reference. The
        // downstream `filtered.push(makePlansSection(...))` then
        // mutated the store's items array, so the next filterCompleted
        // pass saw the stale Plans as a real section and pushed another
        // one — duplicating the section on every toggle.
        const provider = new ProjectsTodoTreeProvider(store);

        const collectPlansCounts = async () => {
            const roots = await provider.getChildren();
            return roots!
                .filter((p) => p.children!.some((c) => c.text === "Plans"))
                .map((p) => ({
                    name: p.text,
                    plans: p.children!.filter((c) => c.text === "Plans"),
                }));
        };

        const before = await collectPlansCounts();
        expect(before).toHaveLength(2); // alpha + gamma have plans, delta does not
        for (const { name, plans } of before) {
            expect(plans, `${name} initial`).toHaveLength(1);
        }

        provider.toggleShowCompleted();
        provider.toggleShowCompleted();
        provider.toggleShowCompleted();
        provider.toggleShowCompleted();

        const after = await collectPlansCounts();
        for (const { name, plans } of after) {
            expect(plans, `${name} after 4 toggles`).toHaveLength(1);
        }
    });
});

describe("ProjectsTodoTreeProvider — Current Workspace section", () => {
    let tempDir: string;
    let store: ProjectsTodoStore;
    let workspaceFolder: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), "superset-prov-ws-"));
        vi.mocked(os.homedir).mockReturnValue(tempDir);

        // ~/projects stub so the existing ~/projects scan path
        // doesn't blow up if some test happens to trigger it.
        const projectsDir = join(tempDir, "projects");
        mkdirSync(projectsDir);

        workspaceFolder = join(tempDir, "ws");
        mkdirSync(workspaceFolder);

        store = new ProjectsTodoStore();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("renders workspace sub-projects directly in the Workspace TODO sub-panel", async () => {
        const nested = join(workspaceFolder, "src", "todo");
        mkdirSync(nested, { recursive: true });
        writeFileSync(join(nested, "README.todo"), "# TODO\n- [ ] nested\n");

        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const provider = new ProjectsTodoTreeProvider(store, workspaceFolder, undefined, "workspace");
        const roots = await provider.getChildren();

        expect(roots).toHaveLength(1);
        expect(roots![0].text).toBe(join("src", "todo"));
        expect(roots![0].projectPath).toBe(nested);
    });

    it("renders an empty-state placeholder when workspace scan is empty", async () => {
        const provider = new ProjectsTodoTreeProvider(store, workspaceFolder, undefined, "workspace");
        const roots = await provider.getChildren();

        expect(roots).toHaveLength(1);
        const placeholder = roots![0];
        expect(placeholder.kind).toBe("list");
        expect(placeholder.text).toMatch(/No README\.todo/);
    });

    it("does NOT render workspace rows when workspaceRoot is unset", async () => {
        const provider = new ProjectsTodoTreeProvider(store, undefined, undefined, "workspace");
        const roots = await provider.getChildren();
        expect(roots).toEqual([]);
    });

    it("renders workspace sub-project rows as folder items with 'N pending' description", async () => {
        const nested = join(workspaceFolder, "src");
        mkdirSync(nested);
        writeFileSync(
            join(nested, "README.todo"),
            "## Active\n- [ ] a\n- [ ] b\n- [x] c\n",
        );
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const provider = new ProjectsTodoTreeProvider(store, workspaceFolder, undefined, "workspace");
        const roots = await provider.getChildren();
        const subProject = roots!.find((c) => c.text === "src")!;

        const item = provider.getTreeItem(subProject);
        expect(item.contextValue).toBe("projectsTodoProject");
        expect(item.description).toBe("2 pending");
        expect(item.collapsibleState).toBe(1); // Collapsed
    });

    it("suppresses the ~/projects duplicate when the same path is also a workspace sub-project", async () => {
        const projectsDir = join(tempDir, "projects", "tmp");
        mkdirSync(projectsDir, { recursive: true });

        workspaceFolder = join(projectsDir, "superset");
        mkdirSync(workspaceFolder);
        writeFileSync(join(workspaceFolder, "README.todo"), "# TODO\n- [ ] dual\n");

        await store.load();
        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const workspaceProvider = new ProjectsTodoTreeProvider(store, workspaceFolder, undefined, "workspace");
        const workspaceRoots = await workspaceProvider.getChildren();
        expect(workspaceRoots!.find((c) => c.projectPath === workspaceFolder)).toBeDefined();

        const projectsProvider = new ProjectsTodoTreeProvider(store, workspaceFolder, undefined, "projects");
        const projectRoots = await projectsProvider.getChildren();
        const duplicate = projectRoots!.find(
            (r) => r.text === "superset" && r.projectPath === workspaceFolder,
        );
        expect(duplicate).toBeUndefined();
    });

    it("renders the workspace root in the Workspace TODO sub-panel when only root has README.todo", async () => {
        writeFileSync(join(workspaceFolder, "README.todo"), "# TODO\n- [ ] single\n");

        await store.loadWorkspaceTodos(workspaceFolder, 3);

        const provider = new ProjectsTodoTreeProvider(store, workspaceFolder, undefined, "workspace");
        const roots = await provider.getChildren();

        expect(roots).toHaveLength(1);
        expect(roots![0].text).toBe(basename(workspaceFolder));
    });
});
