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
        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({
            line: 1,
            text: "Task 1",
            checked: false,
        });
        expect(items[1]).toEqual({
            line: 2,
            text: "Task 2",
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
        expect(items[0].checked).toBe(false);
        expect(items[0].children).toHaveLength(2);

        // Subtask 1.1
        expect(items[0].children![0].text).toBe("Subtask 1.1");
        expect(items[0].children![0].checked).toBe(false);
        expect(items[0].children![0].children).toBeUndefined();

        // Subtask 1.2
        expect(items[0].children![1].text).toBe("Subtask 1.2");
        expect(items[0].children![1].checked).toBe(true);
        expect(items[0].children![1].children).toHaveLength(1);

        // Subtask 1.2.1
        expect(items[0].children![1].children![0].text).toBe("Subtask 1.2.1");
        expect(items[0].children![1].children![0].checked).toBe(false);

        // Task 2
        expect(items[1].text).toBe("Task 2");
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
});
