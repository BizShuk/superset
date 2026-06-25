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
    return {
        EventEmitter,
        ThemeIcon,
        ThemeColor,
        Uri,
        TreeItemCollapsibleState,
        TreeItem: class {
            command?: unknown;
            contextValue?: string;
            description?: string;
            iconPath?: unknown;
            label: string;
            tooltip?: string;
            collapsibleState?: number;
            constructor(label: string) {
                this.label = label;
            }
        },
    };
});

import {
    TodoTreeProvider,
    filterCompleted,
} from "../src/todoTreeProvider";
import { TodoStore } from "../src/todoStore";
import type { TodoItem } from "../src/types";

function item(
    text: string,
    checked: boolean,
    children?: TodoItem[],
    kind: "checkbox" | "list" = "checkbox"
): TodoItem {
    return { line: 0, text, checked, children, kind };
}

// ── filterCompleted (pure) ─────────────────────────────

describe("filterCompleted", () => {
    it("returns the input list unchanged when nothing is checked", () => {
        const items = [
            item("a", false),
            item("b", false, [item("b.1", false)]),
        ];
        const out = filterCompleted(items);
        expect(out).toHaveLength(2);
        expect(out[0].text).toBe("a");
        expect(out[1].text).toBe("b");
        expect(out[1].children).toHaveLength(1);
    });

    it("hides a leaf that is fully checked", () => {
        const items = [item("a", false), item("b", true)];
        const out = filterCompleted(items);
        expect(out.map((t) => t.text)).toEqual(["a"]);
    });

    it("keeps a checked parent when it has an unchecked descendant", () => {
        // The core contract: parent checked + pending child = parent
        // stays visible, otherwise the pending child would be
        // unreachable.
        const items = [
            item("parent", true, [item("child", false), item("done", true)]),
        ];
        const out = filterCompleted(items);
        expect(out).toHaveLength(1);
        expect(out[0].text).toBe("parent");
        expect(out[0].checked).toBe(true);
        expect(out[0].children).toHaveLength(1);
        // The pending child survives; the done leaf is filtered.
        expect(out[0].children![0].text).toBe("child");
    });

    it("hides a parent that is checked AND has no surviving children", () => {
        const items = [
            item("parent", true, [item("done-a", true), item("done-b", true)]),
        ];
        const out = filterCompleted(items);
        expect(out).toHaveLength(0);
    });

    it("keeps a parent that is unchecked even with all-done children", () => {
        // Parent itself unchecked → not "fully completed" → stays.
        const items = [
            item("parent", false, [item("done-a", true), item("done-b", true)]),
        ];
        const out = filterCompleted(items);
        expect(out).toHaveLength(1);
        expect(out[0].text).toBe("parent");
        // Children all filtered out → empty children array.
        expect(out[0].children).toEqual([]);
    });

    it("applies the rule recursively at every depth", () => {
        // Mid-level node: checked + has a pending grandchild → stays.
        // Top-level: checked, but a pending grandchild leaks up the
        // ancestry so it ALSO stays.
        const items = [
            item("top", true, [
                item("mid", true, [
                    item("leaf-pending", false),
                    item("leaf-done", true),
                ]),
            ]),
        ];
        const out = filterCompleted(items);
        expect(out).toHaveLength(1);
        expect(out[0].text).toBe("top");
        expect(out[0].children).toHaveLength(1);
        expect(out[0].children![0].text).toBe("mid");
        expect(out[0].children![0].children).toHaveLength(1);
        expect(out[0].children![0].children![0].text).toBe("leaf-pending");
    });

    it("returns a new array (does not mutate the input)", () => {
        const child = item("c", true);
        const parent = item("p", false, [child]);
        const items = [parent];
        const out = filterCompleted(items);
        expect(out).not.toBe(items);
        // The filtered parent has its children replaced with []; the
        // original parent's children list is untouched.
        expect(parent.children).toHaveLength(1);
        expect(out[0].children).toEqual([]);
    });
});

// ── TodoTreeProvider integration ───────────────────────

function makeStore(items: TodoItem[]): TodoStore {
    const store = new TodoStore("/workspace");
    // Bypass file I/O — the provider only reads from store.getItems().
    (store as unknown as { items: TodoItem[] }).items = items;
    return store;
}

function visibleTexts(provider: TodoTreeProvider, parent?: TodoItem): string[] {
    const children = provider.getChildren(parent) as TodoItem[];
    return children.map((c) => c.text);
}

describe("TodoTreeProvider filter", () => {
    it("defaults to showCompleted=true (no items hidden)", () => {
        const store = makeStore([item("a", false), item("b", true)]);
        const provider = new TodoTreeProvider(store);
        expect(provider.isShowingCompleted()).toBe(true);
        expect(visibleTexts(provider)).toEqual(["a", "b"]);
    });

    it("toggleShowCompleted flips the flag and refreshes", () => {
        const store = makeStore([item("a", false), item("b", true)]);
        const provider = new TodoTreeProvider(store);
        // Subscribe to ensure refresh() doesn't throw in the test env.
        provider.onDidChangeTreeData(() => {});
        expect(provider.toggleShowCompleted()).toBe(false);
        expect(provider.isShowingCompleted()).toBe(false);
        // Pending first, completed last — and "b" is now hidden.
        expect(visibleTexts(provider)).toEqual(["a"]);
        // Flip back → "b" returns.
        expect(provider.toggleShowCompleted()).toBe(true);
        expect(visibleTexts(provider)).toEqual(["a", "b"]);
    });

    it("keeps a checked parent visible when a child is still pending", () => {
        const store = makeStore([
            item("Feature", true, [
                item("sub-done", true),
                item("sub-pending", false),
            ]),
        ]);
        const provider = new TodoTreeProvider(store);
        provider.onDidChangeTreeData(() => {});

        expect(provider.toggleShowCompleted()).toBe(false);

        // Top level: "Feature" survives (has pending descendant).
        const top = visibleTexts(provider);
        expect(top).toEqual(["Feature"]);

        // Expanding it shows only the pending child.
        const parent = provider.getChildren() as TodoItem[];
        const expanded = visibleTexts(provider, parent[0]);
        expect(expanded).toEqual(["sub-pending"]);
    });

    it("hides a checked parent whose descendants are all done", () => {
        const store = makeStore([
            item("all-done", true, [
                item("child-1", true),
                item("child-2", true),
            ]),
            item("still-pending", false),
        ]);
        const provider = new TodoTreeProvider(store);
        provider.onDidChangeTreeData(() => {});

        expect(provider.toggleShowCompleted()).toBe(false);
        expect(visibleTexts(provider)).toEqual(["still-pending"]);
    });

    it("hides a checked parent that has no children", () => {
        const store = makeStore([
            item("lone-done", true),
            item("lone-pending", false),
        ]);
        const provider = new TodoTreeProvider(store);
        provider.onDidChangeTreeData(() => {});

        expect(provider.toggleShowCompleted()).toBe(false);
        expect(visibleTexts(provider)).toEqual(["lone-pending"]);
    });
});

// ── List-only nodes ───────────────────────────────────
//
// `kind: "list"` nodes (a `- foo` / `* bar` / `+ baz` line without
// the `[ ]` checkbox marker) are kept in the panel as a non-togglable
// sibling. They have no completion state, so the "hide completed"
// filter never touches them, and mixing them with checkbox siblings
// forces the document order to be preserved (the pending-first sort
// would be meaningless for them).

describe("TodoTreeProvider list nodes", () => {
    it("renders list nodes with no toggle command and contextValue 'todoList'", () => {
        const store = makeStore([item("note", false, undefined, "list")]);
        const provider = new TodoTreeProvider(store);
        const ti = provider.getTreeItem(store.getItems()[0]);
        expect(ti.command).toBeUndefined();
        expect(ti.contextValue).toBe("todoList");
    });

    it("keeps list nodes visible even when filtering hides completed", () => {
        const store = makeStore([
            item("note", false, undefined, "list"),
            item("Done leaf", true),
            item("Pending leaf", false),
        ]);
        const provider = new TodoTreeProvider(store);
        provider.onDidChangeTreeData(() => {});

        expect(provider.toggleShowCompleted()).toBe(false);
        // The note survives; the completed leaf is hidden. Document
        // order is preserved because of the list sibling.
        expect(visibleTexts(provider)).toEqual(["note", "Pending leaf"]);
    });

    it("preserves document order when list is mixed with checkboxes", () => {
        // pending-first / completed-last sort only applies when ALL
        // siblings are checkboxes. Once a list node is present, sort
        // is a no-op and the original file order wins.
        const store = makeStore([
            item("note", false, undefined, "list"),
            item("done", true),
            item("pending", false),
        ]);
        const provider = new TodoTreeProvider(store);
        expect(visibleTexts(provider)).toEqual([
            "note",
            "done",
            "pending",
        ]);
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
        expect(tiP0.label).toBe("P0 fix core bug");
        expect((tiP0.iconPath as any).path).toBe("/extension/resources/p0.svg");

        const tiP1 = provider.getTreeItem(items[1]);
        expect(tiP1.label).toBe("[P1]: investigate lag");
        expect((tiP1.iconPath as any).path).toBe("/extension/resources/p1.svg");

        const tiP2 = provider.getTreeItem(items[2]);
        expect(tiP2.label).toBe("(p2) - documentation update");
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

        expect(ti.label).toBe("P0 completed bugfix");
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
});
