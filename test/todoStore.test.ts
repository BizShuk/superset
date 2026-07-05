import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TodoStore } from "../src/todo/todoStore";
import { readFile, writeFile } from "fs/promises";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("fs/promises", () => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
}));

describe("TodoStore", () => {
    const workspaceRoot = "/workspace";

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-05T10:44:41"));
    });

    afterEach(() => {
        vi.useRealTimers();
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
        // lines survive under Default section.
        expect(items).toHaveLength(1);
        expect(items[0].text).toBe("Default");
        expect(items[0].children).toHaveLength(2);
        expect(items[0].children![0]).toEqual({
            line: 1,
            text: "Task 1",
            kind: "checkbox",
            checked: false,
            parentSection: "Default",
        });
        expect(items[0].children![1]).toEqual({
            line: 2,
            text: "Task 2",
            kind: "checkbox",
            checked: true,
            parentSection: "Default",
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
        expect(items).toHaveLength(1);
        expect(items[0].text).toBe("Default");
        expect(items[0].children).toHaveLength(2);

        // Task 1
        expect(items[0].children![0].text).toBe("Task 1");
        expect(items[0].children![0].kind).toBe("checkbox");
        expect(items[0].children![0].checked).toBe(false);
        expect(items[0].children![0].children).toHaveLength(2);

        // Subtask 1.1
        expect(items[0].children![0].children![0].text).toBe("Subtask 1.1");
        expect(items[0].children![0].children![0].kind).toBe("checkbox");
        expect(items[0].children![0].children![0].checked).toBe(false);
        expect(items[0].children![0].children![0].children).toBeUndefined();

        // Subtask 1.2
        expect(items[0].children![0].children![1].text).toBe("Subtask 1.2");
        expect(items[0].children![0].children![1].kind).toBe("checkbox");
        expect(items[0].children![0].children![1].checked).toBe(true);
        expect(items[0].children![0].children![1].children).toHaveLength(1);

        // Subtask 1.2.1
        expect(items[0].children![0].children![1].children![0].text).toBe("Subtask 1.2.1");
        expect(items[0].children![0].children![1].children![0].kind).toBe("checkbox");
        expect(items[0].children![0].children![1].children![0].checked).toBe(false);

        // Task 2
        expect(items[0].children![1].text).toBe("Task 2");
        expect(items[0].children![1].kind).toBe("checkbox");
        expect(items[0].children![1].checked).toBe(false);
        expect(items[0].children![1].children).toBeUndefined();

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

        const subtask = store.getItems()[0].children![0].children![0];
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
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            text: "Section",
            kind: "section",
        });
        const sectionItems = items[0].children!;
        expect(sectionItems.map((i) => i.text)).toEqual(["Done item"]);
        // The indented `- text...` line is a list-only node, which
        // IS kept (as a child of Done item).
        expect(sectionItems[0].children).toHaveLength(1);
        expect(sectionItems[0].children![0].kind).toBe("list");
        expect(sectionItems[0].children![0].text).toBe(
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
        expect(items).toHaveLength(1);
        expect(items[0].text).toBe("Default");
        const defaultItems = items[0].children!;
        // "done" checkbox at top, "bare list item" list at top, then
        // the indented list nodes under it. Headings & quotes gone.
        expect(defaultItems.map((i) => i.text)).toEqual([
            "done",
            "bare list item",
        ]);
        // Top-level "done" has no children.
        expect(defaultItems[0].kind).toBe("checkbox");
        expect(defaultItems[0].children).toBeUndefined();
        // "bare list item" → list, with two list children.
        const listItem = defaultItems[1];
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
        expect(items).toHaveLength(1);
        const defaultItems = items[0].children!;
        expect(defaultItems).toHaveLength(4);
        expect(defaultItems[0]).toMatchObject({ text: "star unchecked", kind: "checkbox", checked: false });
        expect(defaultItems[1]).toMatchObject({ text: "plus checked", kind: "checkbox", checked: true });
        expect(defaultItems[2]).toMatchObject({ text: "dash unchecked", kind: "checkbox", checked: false });
        expect(defaultItems[3]).toMatchObject({ text: "star checked", kind: "checkbox", checked: true });
        expect(store.getCompletedCount()).toBe(2);
    });

    it("updatePriority rewrites the priority prefix in README.todo", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-priority-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "- [ ] [P0] Old name\n- [ ] Keep me\n", "utf8");
        // For this test, route the mocked fs/promises calls through
        // the real filesystem so updatePriority actually persists.
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);
        const store = new TodoStore(dir);
        await store.load();
        const item = store.getItems()[0].children![0];
        await store.updatePriority(item, "P1");
        const after = readFileSync(file, "utf8");
        expect(after).toContain("[P1] Old name");
        expect(after).not.toContain("[P0] Old name");
    });

    it("updatePriority reloads items so subsequent reads see the new prefix", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-priority-reload-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "- [ ] [P0] Task\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);
        const store = new TodoStore(dir);
        await store.load();
        expect(store.getItems()[0].children![0].text).toBe("[P0] Task");
        await store.updatePriority(store.getItems()[0].children![0], "P2");
        // After updatePriority the store should have re-loaded so a fresh
        // getItems() returns the new prefix (UI re-renders from this).
        expect(store.getItems()[0].children![0].text).toBe("[P2] Task");
    });

    it("updatePriority emits 'loaded' so the tree re-renders with fresh data", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-priority-loaded-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "- [ ] [P0] Task\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);
        const store = new TodoStore(dir);
        await store.load();
        const events: string[] = [];
        store.onDidChange((c) => events.push(c.type));
        await store.updatePriority(store.getItems()[0].children![0], "P1");
        expect(events).toContain("loaded");
    });

    it("updatePriority inserts a [Px] prefix when the line has none", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-priority-insert-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "- [ ] plain task\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);
        const store = new TodoStore(dir);
        await store.load();
        await store.updatePriority(store.getItems()[0].children![0], "P2");
        const after = readFileSync(file, "utf8");
        expect(after).toContain("- [ ] [P2] plain task");
    });

    it("parses sections and headings correctly", async () => {
        const fileContent = `# TODO
- [ ] Task 0
## Features
- [ ] Task 1
  - [ ] Subtask 1.1
### Iteration 2
- [x] Task 2
`;
        vi.mocked(readFile).mockResolvedValue(fileContent);

        const store = new TodoStore(workspaceRoot);
        await store.load();

        const items = store.getItems();
        expect(items).toHaveLength(3);

        expect(items[0]).toMatchObject({
            text: "Default",
            kind: "section",
        });
        expect(items[0].children).toHaveLength(1);
        expect(items[0].children![0].text).toBe("Task 0");

        expect(items[1]).toMatchObject({
            text: "Features",
            kind: "section",
        });
        expect(items[1].children).toHaveLength(1);
        expect(items[1].children![0].text).toBe("Task 1");
        expect(items[1].children![0].children![0].text).toBe("Subtask 1.1");

        expect(items[2]).toMatchObject({
            text: "Iteration 2",
            kind: "section",
        });
        expect(items[2].children).toHaveLength(1);
        expect(items[2].children![0].text).toBe("Task 2");
    });

    it("addTodo inserts item into existing section", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-add-existing-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n## Features\n- [ ] Task 1\n\n## Iteration 2\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        await store.addTodo("New Task", "Features");

        const content = readFileSync(file, "utf8");
        expect(content).toContain("## Features\n- [ ] Task 1\n- [ ] New Task");
    });

    it("addTodo creates new section if it does not exist", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-add-new-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 0\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        await store.addTodo("New Task", "modify");

        const content = readFileSync(file, "utf8");
        expect(content).toContain("## modify\n- [ ] New Task");
    });

    it("addTodo inserts item at the head of the Default section when there are existing items", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-add-default-head-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 1\n- [ ] Task 2\n\n## Features\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        await store.addTodo("New Task", "Default");

        const content = readFileSync(file, "utf8");
        expect(content).toBe("# TODO\n\n- [ ] New Task\n- [ ] Task 1\n- [ ] Task 2\n\n## Features\n");
    });

    it("addTodo inserts item at the head of the Default section when it is empty", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-add-default-empty-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n## Features\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        await store.addTodo("New Task", "Default");

        const content = readFileSync(file, "utf8");
        expect(content).toBe("# TODO\n\n- [ ] New Task\n\n## Features\n");
    });

    it("archiveTodo moves a task and its children, creates Archive section if not exist, and does not check main task", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-archive-create-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 1\n  - [ ] Subtask 1.1\n- [ ] Task 2\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const task1 = store.getItems()[0].children![0]; // Task 1
        await store.archiveTodo(task1);

        const content = readFileSync(file, "utf8");
        expect(content).toBe("# TODO\n\n- [ ] Task 2\n\n## Archive\n\n- [ ] Task 1 @2026-07-05_10:44:41 @Archived\n  - [ ] Subtask 1.1");
    });

    it("archiveTodo moves a task to the head of the Archive section when it already exists", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-archive-existing-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 1\n- [ ] Task 2\n\n## Archive\n- [x] Old Archived\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const task2 = store.getItems()[0].children![1]; // Task 2
        await store.archiveTodo(task2);

        const content = readFileSync(file, "utf8");
        expect(content).toBe("# TODO\n\n- [ ] Task 1\n\n## Archive\n\n- [ ] Task 2 @2026-07-05_10:44:41 @Archived\n- [x] Old Archived\n");
    });

    it("moveTodo moves a task and its children to an existing section", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-move-existing-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 1\n  - [ ] Subtask 1.1\n- [ ] Task 2\n\n## TargetSection\n- [ ] Existing Target Task\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const task1 = store.getItems()[0].children![0]; // Task 1
        await store.moveTodo(task1, "TargetSection");

        const content = readFileSync(file, "utf8");
        expect(content).toBe("# TODO\n\n- [ ] Task 2\n\n## TargetSection\n- [ ] Existing Target Task\n- [ ] Task 1\n  - [ ] Subtask 1.1");
    });

    it("moveTodo moves a task and its children to a new section, creating the heading", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-move-new-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 1\n  - [ ] Subtask 1.1\n- [ ] Task 2\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const task1 = store.getItems()[0].children![0]; // Task 1
        await store.moveTodo(task1, "NewSection");

        const content = readFileSync(file, "utf8");
        expect(content).toBe("# TODO\n\n- [ ] Task 2\n\n## NewSection\n- [ ] Task 1\n  - [ ] Subtask 1.1");
    });

    it("moveTodo moves a task from a section to the Default section", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-move-to-default-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 1\n\n## OtherSection\n- [ ] Task 2\n  - [ ] Subtask 2.1\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const task2 = store.getItems()[1].children![0]; // Task 2 under OtherSection
        await store.moveTodo(task2, "Default");

        const content = readFileSync(file, "utf-8");
        expect(content).toBe("# TODO\n\n- [ ] Task 2\n  - [ ] Subtask 2.1\n- [ ] Task 1\n\n## OtherSection\n");
    });

    it("deleteSection removes general section and its todo items from README.todo", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-delete-general-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 0\n\n## Features\n- [ ] Task 1\n  - [ ] Subtask 1.1\n\n## Iteration 2\n- [ ] Task 2\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const featuresSection = store.getItems()[1]; // Features Section
        expect(featuresSection.text).toBe("Features");
        expect(featuresSection.kind).toBe("section");

        await store.deleteSection(featuresSection);

        const content = readFileSync(file, "utf8");
        expect(content).toBe("# TODO\n\n- [ ] Task 0\n\n## Iteration 2\n- [ ] Task 2\n");
    });

    it("deleteSection removes Default section items from README.todo", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-delete-default-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 0\n  - [ ] Subtask 0.1\n\n## Features\n- [ ] Task 1\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const defaultSection = store.getItems()[0]; // Default Section
        expect(defaultSection.text).toBe("Default");
        expect(defaultSection.kind).toBe("section");

        await store.deleteSection(defaultSection);

        const content = readFileSync(file, "utf8");
        expect(content).toBe("# TODO\n\n## Features\n- [ ] Task 1\n");
    });

    it("updateText updates todo text preserving checkbox/list prefix", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-rename-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 0\n  - [x] Subtask 0.1\n- Bare item\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        // 1. Rename a checkbox item (Task 0)
        const defaultSec = store.getItems()[0];
        const task0 = defaultSec.children![0];
        expect(task0.text).toBe("Task 0");
        expect(task0.line).toBe(2);

        await store.updateText(task0.line, "Renamed Task 0");

        let content = readFileSync(file, "utf8");
        expect(content).toContain("- [ ] Renamed Task 0");

        // 2. Rename a nested checkbox item (Subtask 0.1)
        const subtask01 = store.getItems()[0].children![0].children![0];
        expect(subtask01.text).toBe("Subtask 0.1");
        expect(subtask01.line).toBe(3);

        await store.updateText(subtask01.line, "Renamed Subtask 0.1");
        content = readFileSync(file, "utf8");
        expect(content).toContain("  - [x] Renamed Subtask 0.1");

        // 3. Rename a bare list item (Bare item)
        const bareItem = store.getItems()[0].children![1];
        expect(bareItem.text).toBe("Bare item");
        expect(bareItem.line).toBe(4);

        await store.updateText(bareItem.line, "Renamed Bare item");
        content = readFileSync(file, "utf8");
        expect(content).toContain("- Renamed Bare item");
    });

    it("updatePriority can set P0/P1/P2 and None", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-priority-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 0\n- [ ] [P1] Task 1\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const defaultSec = store.getItems()[0];
        const task0 = defaultSec.children![0];
        const task1 = defaultSec.children![1];

        // 1. Add priority to Task 0
        await store.updatePriority(task0, "P0");
        let content = readFileSync(file, "utf8");
        expect(content).toContain("- [ ] [P0] Task 0");

        // 2. Change priority of Task 1 to P2
        await store.updatePriority(task1, "P2");
        content = readFileSync(file, "utf8");
        expect(content).toContain("- [ ] [P2] Task 1");

        // 3. Clear priority of Task 1 by setting to None
        const updatedTask1 = store.getItems()[0].children![1];
        await store.updatePriority(updatedTask1, "None");
        content = readFileSync(file, "utf8");
        expect(content).toContain("- [ ] Task 1");
    });

    it("archiveSection moves a whole section under Archive, demoted to h3, creating Archive if missing", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-archive-section-create-"));
        const file = join(dir, "README.todo");
        writeFileSync(
            file,
            "# TODO\n\n## Terminals\n\n- [x] item1\n- [x] item2\n\n## mDNS\n\n- [ ] item3\n",
            "utf8"
        );
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const terminals = store.getItems().find((i) => i.text === "Terminals")!;
        await store.archiveSection(terminals);

        const content = readFileSync(file, "utf8");
        expect(content).toBe(
            "# TODO\n\n## mDNS\n\n- [ ] item3\n\n## Archive\n\n### Terminals\n\n- [x] item1\n- [x] item2"
        );
    });

    it("archiveSection appends the demoted h3 after an existing Archive section's content, not at its head", async () => {
        // Regression: inserting the new h3 right after the "## Archive"
        // heading would put it directly above the pre-existing flat
        // (headless) archive item, which markdown would then read as
        // nested *under* that h3 instead of as Archive's own content.
        const dir = mkdtempSync(join(tmpdir(), "todo-archive-section-existing-"));
        const file = join(dir, "README.todo");
        writeFileSync(
            file,
            "# TODO\n\n## Terminals\n\n- [x] item1\n\n## Archive\n\n- [ ] old archived item\n",
            "utf8"
        );
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const terminals = store.getItems().find((i) => i.text === "Terminals")!;
        await store.archiveSection(terminals);

        const content = readFileSync(file, "utf8");
        expect(content).toBe(
            "# TODO\n\n## Archive\n\n- [ ] old archived item\n\n### Terminals\n\n- [x] item1"
        );
    });

    it("archiveSection keeps a blank line before a section that follows Archive", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-archive-section-followed-"));
        const file = join(dir, "README.todo");
        writeFileSync(
            file,
            "# TODO\n\n## Terminals\n\n- [x] item1\n\n## Archive\n\n- [ ] old archived item\n\n## Plans\n",
            "utf8"
        );
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const terminals = store.getItems().find((i) => i.text === "Terminals")!;
        await store.archiveSection(terminals);

        const content = readFileSync(file, "utf8");
        expect(content).toBe(
            "# TODO\n\n## Plans\n\n## Archive\n\n- [ ] old archived item\n\n### Terminals\n\n- [x] item1\n"
        );
    });

    it("archiveSection appends a second archived section after the first as a sibling h3", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-archive-section-second-"));
        const file = join(dir, "README.todo");
        writeFileSync(
            file,
            "# TODO\n\n## Terminals\n\n- [x] item1\n\n## mDNS\n\n- [x] item2\n\n## Archive\n\n- [ ] old archived item\n",
            "utf8"
        );
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const terminals = store.getItems().find((i) => i.text === "Terminals")!;
        await store.archiveSection(terminals);
        const mdns = store.getItems().find((i) => i.text === "mDNS")!;
        await store.archiveSection(mdns);

        const content = readFileSync(file, "utf8");
        expect(content).toBe(
            "# TODO\n\n## Archive\n\n- [ ] old archived item\n\n### Terminals\n\n- [x] item1\n\n### mDNS\n\n- [x] item2"
        );
    });

    it("unarchiveSection promotes an h3 Archive subsection back to a top-level h2, moved before Archive", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-unarchive-section-"));
        const file = join(dir, "README.todo");
        writeFileSync(
            file,
            "# TODO\n\n## mDNS\n\n- [ ] item3\n\n## Archive\n\n### Terminals\n\n- [x] item1\n- [x] item2\n",
            "utf8"
        );
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const archived = store.getItems().find((i) => i.text === "Terminals")!;
        expect(archived.level).toBe(3);
        await store.unarchiveSection(archived);

        const content = readFileSync(file, "utf8");
        expect(content).toBe(
            "# TODO\n\n## mDNS\n\n- [ ] item3\n\n## Terminals\n\n- [x] item1\n- [x] item2\n\n## Archive\n"
        );
    });

    it("archiveSection/unarchiveSection are no-ops for the synthetic Default section", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-archive-section-noop-"));
        const file = join(dir, "README.todo");
        const original = "# TODO\n\n- [ ] Task 0\n";
        writeFileSync(file, original, "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const defaultSection = store.getItems()[0];
        expect(defaultSection.text).toBe("Default");
        await store.archiveSection(defaultSection);
        await store.unarchiveSection(defaultSection);

        expect(readFileSync(file, "utf8")).toBe(original);
        expect(writeFile).not.toHaveBeenCalled();
    });

    it("deleteTodo removes a task and its children from README.todo", async () => {
        const dir = mkdtempSync(join(tmpdir(), "todo-delete-"));
        const file = join(dir, "README.todo");
        writeFileSync(file, "# TODO\n\n- [ ] Task 1\n  - [ ] Subtask 1.1\n- [ ] Task 2\n", "utf8");
        vi.mocked(readFile).mockImplementation((async (p: string) =>
            readFileSync(p, "utf8")) as typeof readFile);
        vi.mocked(writeFile).mockImplementation((async (p: string, data: string) => {
            writeFileSync(p, data, "utf8");
        }) as typeof writeFile);

        const store = new TodoStore(dir);
        await store.load();

        const task1 = store.getItems()[0].children![0]; // Task 1
        await store.deleteTodo(task1);

        const content = readFileSync(file, "utf8");
        expect(content).toBe("# TODO\n\n- [ ] Task 2\n");
    });
});

