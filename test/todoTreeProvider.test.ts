import { describe, it, expect, vi } from "vitest";

// Minimal vscode mock — the provider only uses EventEmitter (for
// `onDidChangeTreeData` refresh) and TreeItem / ThemeIcon / ThemeColor
// inside `getTreeItem`, which the filter tests never call.
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

import {
    TodoTreeProvider,
    filterCompleted,
    applyPriorityFilter,
    extractLink,
    cleanLabelText,
    resolveTodoLink,
} from "../src/todo/todoTreeProvider";
import { TodoStore } from "../src/todo/todoStore";
import type { TodoItem } from "../src/todo/types";

function item(
    text: string,
    checked = false,
    children?: TodoItem[],
    kind: "checkbox" | "list" = "checkbox"
): TodoItem {
    return { line: 0, text, checked, kind, children };
}

function makeStore(items: TodoItem[]): TodoStore {
    const store = new TodoStore("/tmp/todo-test");
    // @ts-ignore — private; test only
    store.items = items;
    return store;
}

function visibleTexts(provider: TodoTreeProvider): string[] {
    const top = provider.getChildren() as TodoItem[];
    return top.map((t) => t.text);
}

describe("applyPriorityFilter", () => {
    it("returns items unchanged when filter set is empty", () => {
        const input: TodoItem[] = [
            { line: 0, text: "[P0] a", kind: "checkbox", checked: false },
            { line: 1, text: "[P1] b", kind: "checkbox", checked: false },
            { line: 2, text: "no-prio", kind: "checkbox", checked: false },
        ];
        const out = applyPriorityFilter(input, new Set());
        expect(out).toHaveLength(3);
    });

    it("keeps only matching priorities", () => {
        const input: TodoItem[] = [
            { line: 0, text: "[P0] a", kind: "checkbox", checked: false },
            { line: 1, text: "[P1] b", kind: "checkbox", checked: false },
            { line: 2, text: "[P2] c", kind: "checkbox", checked: false },
            { line: 3, text: "no-prio", kind: "checkbox", checked: false },
        ];
        const out = applyPriorityFilter(input, new Set(["P0", "P1"]));
        expect(out.map((i) => i.text)).toEqual(["[P0] a", "[P1] b"]);
    });

    it("filters recursively into children", () => {
        const input: TodoItem[] = [
            {
                line: 0,
                text: "[P0] parent",
                kind: "checkbox",
                checked: false,
                children: [
                    { line: 1, text: "[P0] child", kind: "checkbox", checked: false },
                    { line: 2, text: "[P2] grandchild", kind: "checkbox", checked: false },
                ],
            },
        ];
        const out = applyPriorityFilter(input, new Set(["P0"]));
        expect(out).toHaveLength(1);
        expect(out[0].children).toHaveLength(1);
        expect(out[0].children![0].text).toBe("[P0] child");
    });

    it("hides items without priority prefix when any filter is active", () => {
        const input: TodoItem[] = [
            { line: 0, text: "[P0] a", kind: "checkbox", checked: false },
            { line: 1, text: "no-prio", kind: "checkbox", checked: false },
        ];
        const out = applyPriorityFilter(input, new Set(["P0"]));
        expect(out).toHaveLength(1);
        expect(out[0].text).toBe("[P0] a");
    });

    it("keeps section items if they contain matching children", () => {
        const input: TodoItem[] = [
            {
                line: 0,
                text: "Section 1",
                kind: "section",
                checked: false,
                children: [
                    { line: 1, text: "[P0] matching", kind: "checkbox", checked: false },
                    { line: 2, text: "[P2] non-matching", kind: "checkbox", checked: false },
                ],
            },
            {
                line: 3,
                text: "Section 2",
                kind: "section",
                checked: false,
                children: [
                    { line: 4, text: "[P2] non-matching 2", kind: "checkbox", checked: false },
                ],
            },
        ];
        const out = applyPriorityFilter(input, new Set(["P0"]));
        expect(out).toHaveLength(1);
        expect(out[0].text).toBe("Section 1");
        expect(out[0].children).toHaveLength(1);
        expect(out[0].children![0].text).toBe("[P0] matching");
    });

    it("toggling adds and removes a priority from the set", () => {
        const store = makeStore([]);
        const provider = new TodoTreeProvider(store);
        expect(provider.isPriorityEnabled("P0")).toBe(false);
        expect(provider.togglePriorityFilter("P0")).toBe(true);
        expect(provider.isPriorityEnabled("P0")).toBe(true);
        expect(provider.togglePriorityFilter("P0")).toBe(false);
        expect(provider.isPriorityEnabled("P0")).toBe(false);
    });
});

describe("filterCompleted", () => {
    it("strips a fully-done subtree below a pending node", () => {
        const input: TodoItem[] = [
            {
                line: 0,
                text: "parent",
                kind: "checkbox",
                checked: false,
                children: [
                    { line: 1, text: "done-child", kind: "checkbox", checked: true },
                    { line: 2, text: "done-grandchild", kind: "checkbox", checked: true },
                ],
            },
        ];
        const result = filterCompleted(input);
        expect(result).toHaveLength(1);
        expect(result[0].children).toHaveLength(0);
    });

    it("keeps a pending node even if it has some done descendants", () => {
        const input: TodoItem[] = [
            {
                line: 0,
                text: "parent",
                kind: "checkbox",
                checked: false,
                children: [
                    { line: 1, text: "done-child", kind: "checkbox", checked: true },
                    { line: 2, text: "pending-grandchild", kind: "checkbox", checked: false },
                ],
            },
        ];
        const result = filterCompleted(input);
        expect(result).toHaveLength(1);
        expect(result[0].children).toHaveLength(1);
        expect(result[0].children![0].text).toBe("pending-grandchild");
    });

    it("removes a leaf checkbox that is checked", () => {
        const input: TodoItem[] = [
            { line: 0, text: "done", kind: "checkbox", checked: true },
        ];
        expect(filterCompleted(input)).toHaveLength(0);
    });

    it("keeps a pending leaf checkbox", () => {
        const input: TodoItem[] = [
            { line: 0, text: "pending", kind: "checkbox", checked: false },
        ];
        expect(filterCompleted(input)).toHaveLength(1);
    });

    it("keeps list nodes regardless of children", () => {
        const input: TodoItem[] = [
            {
                line: 0,
                text: "note",
                kind: "list",
                checked: false,
                children: [
                    { line: 1, text: "done", kind: "checkbox", checked: true },
                ],
            },
        ];
        const result = filterCompleted(input);
        expect(result).toHaveLength(1);
        expect(result[0].kind).toBe("list");
    });
});

describe("TodoTreeProvider", () => {
    it("renders pending items with yellow circle icon", () => {
        const store = makeStore([item("Wake up", false)]);
        const provider = new TodoTreeProvider(store);
        const ti = provider.getTreeItem(store.getItems()[0]);
        expect(ti.label).toBe("Wake up");
        expect((ti.iconPath as any).id).toBe("circle-large-outline");
    });

    it("renders completed items with green pass icon", () => {
        const store = makeStore([item("Wake up", true)]);
        const provider = new TodoTreeProvider(store);
        const ti = provider.getTreeItem(store.getItems()[0]);
        expect(ti.label).toBe("Wake up");
        expect((ti.iconPath as any).id).toBe("pass");
    });

    it("sorts pending first, completed last", () => {
        const store = makeStore([item("second", true), item("first", false)]);
        const provider = new TodoTreeProvider(store);
        expect(visibleTexts(provider)).toEqual(["first", "second"]);
    });

    it("preserves document order when list nodes are mixed in", () => {
        const store = makeStore([
            item("list-node", false, undefined, "list"),
            item("done", true),
            item("pending", false),
        ]);
        const provider = new TodoTreeProvider(store);
        // When a list node is present among checkboxes, sortSiblings returns
        // items unchanged (allCheckboxes=false path) — list node position
        // is preserved, checkbox siblings are NOT reordered.
        expect(visibleTexts(provider)).toEqual(["list-node", "done", "pending"]);
    });

    it("toggles showCompleted and returns the new value", () => {
        const store = makeStore([]);
        const provider = new TodoTreeProvider(store);
        expect(provider.toggleShowCompleted()).toBe(false);
        expect(provider.toggleShowCompleted()).toBe(true);
    });

    it("still sorts pending-first when all siblings are checkboxes", () => {
        const store = makeStore([item("done", true), item("pending", false)]);
        const provider = new TodoTreeProvider(store);
        expect(visibleTexts(provider)).toEqual(["pending", "done"]);
    });

    it("filter still hides a checkbox with all-checked descendants under a list node", () => {
        // List node stays; its all-done checkbox child is filtered.
        const store = makeStore([
            item(
                "section",
                false,
                [item("all-done", true, [item("child-1", true)])],
                "list"
            ),
        ]);
        const provider = new TodoTreeProvider(store);
        provider.onDidChangeTreeData(() => {});

        expect(provider.toggleShowCompleted()).toBe(false);
        const top = provider.getChildren() as TodoItem[];
        expect(top).toHaveLength(1);
        expect(top[0].text).toBe("section");
        expect(top[0].children).toEqual([]);
    });
});

describe("TodoTreeProvider priority icons", () => {
    const mockUri = { path: "/extension" } as any;

    it("parses P0/P1/P2 from checkbox items and uses custom SVG icons", () => {
        const store = makeStore([
            item("P0 fix core bug", false),
            item("[P1]: investigate lag", false),
            item("(p2) - documentation update", false),
            item("Normal task", false),
        ]);
        const provider = new TodoTreeProvider(store, mockUri);
        const items = store.getItems();

        const tiP0 = provider.getTreeItem(items[0]);
        expect(tiP0.label).toBe("fix core bug");
        expect((tiP0.iconPath as any).path).toBe("/extension/resources/p0.svg");

        const tiP1 = provider.getTreeItem(items[1]);
        expect(tiP1.label).toBe("investigate lag");
        expect((tiP1.iconPath as any).path).toBe("/extension/resources/p1.svg");

        const tiP2 = provider.getTreeItem(items[2]);
        expect(tiP2.label).toBe("documentation update");
        expect((tiP2.iconPath as any).path).toBe("/extension/resources/p2.svg");

        const tiNormal = provider.getTreeItem(items[3]);
        expect(tiNormal.label).toBe("Normal task");
        expect((tiNormal.iconPath as any).id).toBe("circle-large-outline");
    });

    it("restores to pass icon for completed items even if they have priority prefixes", () => {
        const store = makeStore([
            item("P0 completed bugfix", true),
        ]);
        const provider = new TodoTreeProvider(store, mockUri);
        const ti = provider.getTreeItem(store.getItems()[0]);

        expect(ti.label).toBe("completed bugfix");
        expect((ti.iconPath as any).id).toBe("pass");
    });

    it("parses P0/P1/P2 from list items and uses custom SVG icons", () => {
        const store = makeStore([
            item("[P0] important note", false, undefined, "list"),
        ]);
        const provider = new TodoTreeProvider(store, mockUri);
        const ti = provider.getTreeItem(store.getItems()[0]);

        expect(ti.label).toBe("important note");
        expect((ti.iconPath as any).path).toBe("/extension/resources/p0.svg");
    });

    it("handles links in checkbox and list items by cleaning label and updating contextValue", () => {
        const store = makeStore([
            item("task with [link](https://google.com)", false),
            item("note with [plan](plans/some-plan.md)", false, undefined, "list"),
        ]);
        const provider = new TodoTreeProvider(store, mockUri);
        
        const tiCheckbox = provider.getTreeItem(store.getItems()[0]);
        expect(tiCheckbox.label).toBe("task with link");
        expect(tiCheckbox.contextValue).toBe("todoCheckboxWithLink");

        const tiList = provider.getTreeItem(store.getItems()[1]);
        expect(tiList.label).toBe("note with plan");
        expect(tiList.contextValue).toBe("todoListWithLink");
    });
});

describe("extractLink and cleanLabelText helper functions", () => {
    it("extracts markdown link target", () => {
        expect(extractLink("see [plans/xxx.md](plans/xxx.md)")).toBe("plans/xxx.md");
        expect(extractLink("some task [google](https://google.com) details")).toBe("https://google.com");
    });

    it("extracts raw HTTP/HTTPS URLs", () => {
        expect(extractLink("visit https://example.com/page for details")).toBe("https://example.com/page");
    });

    it("returns null if no link is present", () => {
        expect(extractLink("normal task text")).toBeNull();
    });

    it("cleans markdown link from label text", () => {
        expect(cleanLabelText("see [plans/xxx.md](plans/xxx.md)")).toBe("see plans/xxx.md");
        expect(cleanLabelText("some task [google](https://google.com) details")).toBe("some task google details");
    });
});

describe("resolveTodoLink helper function", () => {
    it("resolves HTTP/HTTPS links", () => {
        expect(resolveTodoLink("https://google.com", "/workspace")).toEqual({
            type: "url",
            uriOrPath: "https://google.com",
        });
        expect(resolveTodoLink("http://localhost:3000", "/workspace")).toEqual({
            type: "url",
            uriOrPath: "http://localhost:3000",
        });
    });

    it("resolves file:/// absolute URI", () => {
        expect(resolveTodoLink("file:///absolute/path/to/file", "/workspace")).toEqual({
            type: "url",
            uriOrPath: "file:///absolute/path/to/file",
        });
    });

    it("resolves file:// relative link", () => {
        expect(resolveTodoLink("file://plans/xxx.md", "/workspace")).toEqual({
            type: "file",
            uriOrPath: "/workspace/plans/xxx.md",
        });
    });

    it("resolves plain relative link", () => {
        expect(resolveTodoLink("plans/xxx.md", "/workspace")).toEqual({
            type: "file",
            uriOrPath: "/workspace/plans/xxx.md",
        });
        expect(resolveTodoLink("./plans/xxx.md", "/workspace")).toEqual({
            type: "file",
            uriOrPath: "/workspace/plans/xxx.md",
        });
    });

    it("resolves plain absolute path", () => {
        expect(resolveTodoLink("/absolute/path", "/workspace")).toEqual({
            type: "file",
            uriOrPath: "/absolute/path",
        });
    });
});
