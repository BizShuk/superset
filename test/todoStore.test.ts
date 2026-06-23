import { describe, it, expect, vi, beforeEach } from "vitest";
import { TodoStore } from "../src/todoStore";
import { readFile, writeFile } from "fs/promises";

vi.mock("fs/promises", () => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
}));

describe("TodoStore", () => {
    const workspaceRoot = "/workspace";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("parses non-nested checkboxes correctly", async () => {
        const fileContent = `# TODO
- [ ] Task 1
- [x] Task 2
`;
        vi.mocked(readFile).mockResolvedValue(fileContent);

        const store = new TodoStore(workspaceRoot);
        await store.load();

        const items = store.getItems();
        // `# TODO` heading is ignored — only checkbox and list-only
        // lines survive.
        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({
            line: 1,
            text: "Task 1",
            kind: "checkbox",
            checked: false,
        });
        expect(items[1]).toEqual({
            line: 2,
            text: "Task 2",
            kind: "checkbox",
            checked: true,
        });
        expect(store.getCompletedCount()).toBe(1);
    });

    it("parses nested/indented checkboxes correctly", async () => {
        const fileContent = `# TODO
- [ ] Task 1
  - [ ] Subtask 1.1
  - [x] Subtask 1.2
    - [ ] Subtask 1.2.1
- [ ] Task 2
`;
        vi.mocked(readFile).mockResolvedValue(fileContent);

        const store = new TodoStore(workspaceRoot);
        await store.load();

        const items = store.getItems();
        expect(items).toHaveLength(2);

        // Task 1
        expect(items[0].text).toBe("Task 1");
        expect(items[0].kind).toBe("checkbox");
        expect(items[0].checked).toBe(false);
        expect(items[0].children).toHaveLength(2);

        // Subtask 1.1
        expect(items[0].children![0].text).toBe("Subtask 1.1");
        expect(items[0].children![0].kind).toBe("checkbox");
        expect(items[0].children![0].checked).toBe(false);
        expect(items[0].children![0].children).toBeUndefined();

        // Subtask 1.2
        expect(items[0].children![1].text).toBe("Subtask 1.2");
        expect(items[0].children![1].kind).toBe("checkbox");
        expect(items[0].children![1].checked).toBe(true);
        expect(items[0].children![1].children).toHaveLength(1);

        // Subtask 1.2.1
        expect(items[0].children![1].children![0].text).toBe("Subtask 1.2.1");
        expect(items[0].children![1].children![0].kind).toBe("checkbox");
        expect(items[0].children![1].children![0].checked).toBe(false);

        // Task 2
        expect(items[1].text).toBe("Task 2");
        expect(items[1].kind).toBe("checkbox");
        expect(items[1].checked).toBe(false);
        expect(items[1].children).toBeUndefined();

        // Completed count should traverse recursively
        expect(store.getCompletedCount()).toBe(1);
    });

    it("toggles nested items correctly", async () => {
        const fileContent = `# TODO
- [ ] Task 1
  - [ ] Subtask 1.1
`;
        vi.mocked(readFile).mockResolvedValue(fileContent);

        const store = new TodoStore(workspaceRoot);
        await store.load();

        const subtask = store.getItems()[0].children![0];
        expect(subtask.checked).toBe(false);

        await store.toggle(subtask);

        // Check if write file has the toggled subtask
        expect(writeFile).toHaveBeenCalledTimes(1);
        const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
        expect(writtenContent).toContain("  - [x] Subtask 1.1");
        expect(subtask.checked).toBe(true);
    });

    it("ignores headings, blank lines, and quotes", async () => {
        // Headings (`# ...`), quotes (`> ...`), and plain text are
        // never list markers — they are dropped, even if indented.
        // Bare list markers (- foo / * bar / + baz) ARE kept as
        // list-only nodes (see next test).
        const fileContent = `# TODO
## Section

> a quote
- [x] Done item
   - text indented under a checkbox
`;
        vi.mocked(readFile).mockResolvedValue(fileContent);

        const store = new TodoStore(workspaceRoot);
        await store.load();

        const items = store.getItems();
        expect(items.map((i) => i.text)).toEqual(["Done item"]);
        // The indented `- text...` line is a list-only node, which
        // IS kept (as a child of Done item).
        expect(items[0].children).toHaveLength(1);
        expect(items[0].children![0].kind).toBe("list");
        expect(items[0].children![0].text).toBe(
            "text indented under a checkbox"
        );
        expect(store.getCompletedCount()).toBe(1);
    });

    it("keeps bare list markers as list-only nodes", async () => {
        // `- foo` / `* bar` / `+ baz` (no `[ ]`) are preserved as
        // list nodes. Headings and quotes remain ignored.
        const fileContent = `# TODO
- [x] done
- bare list item
  * nested bullet
  + another bullet
> still a quote
`;
        vi.mocked(readFile).mockResolvedValue(fileContent);

        const store = new TodoStore(workspaceRoot);
        await store.load();

        const items = store.getItems();
        // "done" checkbox at top, "bare list item" list at top, then
        // the indented list nodes under it. Headings & quotes gone.
        expect(items.map((i) => i.text)).toEqual([
            "done",
            "bare list item",
        ]);
        // Top-level "done" has no children.
        expect(items[0].kind).toBe("checkbox");
        expect(items[0].children).toBeUndefined();
        // "bare list item" → list, with two list children.
        const listItem = items[1];
        expect(listItem.kind).toBe("list");
        expect(listItem.checked).toBe(false);
        expect(listItem.children).toHaveLength(2);
        expect(listItem.children!.map((c) => c.text)).toEqual([
            "nested bullet",
            "another bullet",
        ]);
        for (const c of listItem.children!) {
            expect(c.kind).toBe("list");
        }
        // List items don't count as completed.
        expect(store.getCompletedCount()).toBe(1);
    });

    it("accepts + and * as checkbox list markers", async () => {
        // Per the markdown spec, `-` / `*` / `+` are interchangeable
        // list markers. Verify all three work for checkbox lines.
        const fileContent = `* [ ] star unchecked
+ [x] plus checked
- [ ] dash unchecked
* [x] star checked
`;
        vi.mocked(readFile).mockResolvedValue(fileContent);

        const store = new TodoStore(workspaceRoot);
        await store.load();

        const items = store.getItems();
        expect(items).toHaveLength(4);
        expect(items[0]).toMatchObject({ text: "star unchecked", kind: "checkbox", checked: false });
        expect(items[1]).toMatchObject({ text: "plus checked", kind: "checkbox", checked: true });
        expect(items[2]).toMatchObject({ text: "dash unchecked", kind: "checkbox", checked: false });
        expect(items[3]).toMatchObject({ text: "star checked", kind: "checkbox", checked: true });
        expect(store.getCompletedCount()).toBe(2);
    });
});
