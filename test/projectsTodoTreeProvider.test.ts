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
});
