import { describe, it, expect, vi, beforeEach } from "vitest";
import { TodoStore } from "../src/todo/todoStore";
import { readFile, writeFile } from "fs/promises";
import { cleanTags, isArchivedTask, parseTagsFromLine, constructTags } from "../src/todo/parser";

vi.mock("fs/promises", () => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
}));

describe("Todo Archiving & Tagging", () => {
    const workspaceRoot = "/workspace";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Tag Helpers", () => {
        it("constructs tags correctly", () => {
            expect(constructTags("2026-07-05_00:00:00", "Completed", "Architecture"))
                .toBe(" @2026-07-05_00:00:00 @Completed @Architecture");
            expect(constructTags("2026-07-05_00:00:00", "Archived", "Default"))
                .toBe(" @2026-07-05_00:00:00 @Archived");
            expect(constructTags("2026-07-05_00:00:00", "Archived", "TODO"))
                .toBe(" @2026-07-05_00:00:00 @Archived");
            expect(constructTags("2026-07-05_00:00:00", "Archived", "todo"))
                .toBe(" @2026-07-05_00:00:00 @Archived");
            expect(constructTags("2026-07-05_00:00:00", "Archived", "In Progress"))
                .toBe(" @2026-07-05_00:00:00 @Archived @In_Progress");
        });

        it("cleans tags correctly", () => {
            expect(cleanTags("task 1 @2026-07-05_00:00:00 @Completed @Architecture")).toBe("task 1");
            expect(cleanTags("task 2 @2026-07-05_00:00:00 @Archived")).toBe("task 2");
            expect(cleanTags("task without tags")).toBe("task without tags");
        });

        it("detects archived tasks", () => {
            expect(isArchivedTask("task 1 @2026-07-05_00:00:00 @Completed @Architecture")).toBe(true);
            expect(isArchivedTask("task 2 @2026-07-05_00:00:00 @Archived")).toBe(true);
            expect(isArchivedTask("task without tags")).toBe(false);
        });

        it("parses tags from lines", () => {
            const line1 = "- [x] todo 1 @2026-07-05_00:00:00 @Completed @Architecture";
            const parsed1 = parseTagsFromLine(line1);
            expect(parsed1).not.toBeNull();
            expect(parsed1?.dateTime).toBe("2026-07-05_00:00:00");
            expect(parsed1?.state).toBe("Completed");
            expect(parsed1?.sectionName).toBe("Architecture");

            const line2 = "- [ ] todo 1 @2026-07-05_00:00:00 @Archived";
            const parsed2 = parseTagsFromLine(line2);
            expect(parsed2).not.toBeNull();
            expect(parsed2?.dateTime).toBe("2026-07-05_00:00:00");
            expect(parsed2?.state).toBe("Archived");
            expect(parsed2?.sectionName).toBeUndefined();

            const line3 = "- [ ] todo 1 @2026-07-05_00:00:00 @Archived @In_Progress";
            const parsed3 = parseTagsFromLine(line3);
            expect(parsed3?.sectionName).toBe("In Progress");
        });
    });

    describe("Store Operations", () => {
        it("moves completed task to Archive section and appends tag on toggle", async () => {
            const fileContent = `# TODO

## Architecture
- [ ] task 1
`;
            vi.mocked(readFile).mockResolvedValue(fileContent);
            let writtenContent = "";
            vi.mocked(writeFile).mockImplementation(async (path, content) => {
                writtenContent = content as string;
            });

            const store = new TodoStore(workspaceRoot);
            await store.load();

            const items = store.getItems();
            // Locate "task 1"
            const section = items.find(i => i.text === "Architecture");
            const task = section?.children?.[0];
            expect(task).toBeDefined();

            await store.toggle(task!);

            // The task should have been completed and moved to ## Archive
            expect(writtenContent).toContain("## Archive");
            expect(writtenContent).toContain("- [x] task 1 @");
            expect(writtenContent).toContain("@Completed @Architecture");
            expect(writtenContent).not.toContain("## Architecture\n- [ ] task 1");
        });

        it("moves unchecked task to Archive and appends tag on archiveTodo", async () => {
            const fileContent = `# TODO

## Plan
- [ ] task 1
`;
            vi.mocked(readFile).mockResolvedValue(fileContent);
            let writtenContent = "";
            vi.mocked(writeFile).mockImplementation(async (path, content) => {
                writtenContent = content as string;
            });

            const store = new TodoStore(workspaceRoot);
            await store.load();

            const items = store.getItems();
            const section = items.find(i => i.text === "Plan");
            const task = section?.children?.[0];
            expect(task).toBeDefined();

            await store.archiveTodo(task!);

            expect(writtenContent).toContain("## Archive");
            expect(writtenContent).toContain("- [ ] task 1 @");
            expect(writtenContent).toContain("@Archived @Plan");
        });

        it("toggles checkbox and swaps tags for task already inside Archive", async () => {
            const fileContent = `# TODO

## Archive
- [x] task 1 @2026-07-05_00:00:00 @Completed @Architecture
`;
            vi.mocked(readFile).mockResolvedValue(fileContent);
            let writtenContent = "";
            vi.mocked(writeFile).mockImplementation(async (path, content) => {
                writtenContent = content as string;
            });

            const store = new TodoStore(workspaceRoot);
            await store.load();

            const items = store.getItems();
            const archiveSection = items.find(i => i.text === "Archive");
            const task = archiveSection?.children?.[0];
            expect(task).toBeDefined();

            await store.toggle(task!);

            expect(writtenContent).toContain("- [ ] task 1 @");
            expect(writtenContent).toContain("@Archived @Architecture");
        });

        it("rolls back task to original section and removes tags", async () => {
            const fileContent = `# TODO

## Architecture

## Archive
- [x] task 1 @2026-07-05_00:00:00 @Completed @Architecture
`;
            vi.mocked(readFile).mockResolvedValue(fileContent);
            let writtenContent = "";
            vi.mocked(writeFile).mockImplementation(async (path, content) => {
                writtenContent = content as string;
            });

            const store = new TodoStore(workspaceRoot);
            await store.load();

            const items = store.getItems();
            const archiveSection = items.find(i => i.text === "Archive");
            const task = archiveSection?.children?.[0];
            expect(task).toBeDefined();

            await store.rollbackTodo(task!);

            expect(writtenContent).toContain("## Architecture\n\n- [x] task 1");
            expect(writtenContent).not.toContain("## Archive\n- [x] task 1");
            expect(writtenContent).not.toContain("@Completed");
        });

        it("rolls back task with no section tag to default section", async () => {
            const fileContent = `# TODO

## Archive
- [x] task 1 @2026-07-05_00:00:00 @Completed
`;
            vi.mocked(readFile).mockResolvedValue(fileContent);
            let writtenContent = "";
            vi.mocked(writeFile).mockImplementation(async (path, content) => {
                writtenContent = content as string;
            });

            const store = new TodoStore(workspaceRoot);
            await store.load();

            const items = store.getItems();
            const archiveSection = items.find(i => i.text === "Archive");
            const task = archiveSection?.children?.[0];
            expect(task).toBeDefined();

            await store.rollbackTodo(task!);

            expect(writtenContent).toContain("# TODO\n\n- [x] task 1\n");
            expect(writtenContent).not.toContain("## Archive\n- [x] task 1");
            expect(writtenContent).not.toContain("@Completed");
        });

        it("rolls back task directly under ## Archive without tags to default section", async () => {
            const fileContent = `# TODO

## Archive
- [x] task 1
`;
            vi.mocked(readFile).mockResolvedValue(fileContent);
            let writtenContent = "";
            vi.mocked(writeFile).mockImplementation(async (path, content) => {
                writtenContent = content as string;
            });

            const store = new TodoStore(workspaceRoot);
            await store.load();

            const items = store.getItems();
            const archiveSection = items.find(i => i.text === "Archive");
            const task = archiveSection?.children?.[0];
            expect(task).toBeDefined();
            expect(task?.parentSection).toBe("Archive");

            await store.rollbackTodo(task!);

            expect(writtenContent).toContain("# TODO\n\n- [x] task 1\n");
            expect(writtenContent).not.toContain("## Archive\n- [x] task 1");
        });

        it("ensures Archive is always the last section", async () => {
            const fileContent = `# TODO

## Archive
- [ ] task 1 @2026-07-05_00:00:00 @Archived @Architecture

## Architecture
`;
            vi.mocked(readFile).mockResolvedValue(fileContent);
            let writtenContent = "";
            vi.mocked(writeFile).mockImplementation(async (path, content) => {
                writtenContent = content as string;
            });

            const store = new TodoStore(workspaceRoot);
            await store.load();

            // Perform any operation to trigger write
            await store.addTodo("task 2", "Architecture");

            // In the written content, ## Archive must be after ## Architecture
            const archPos = writtenContent.indexOf("## Archive");
            const otherPos = writtenContent.indexOf("## Architecture");
            expect(archPos).toBeGreaterThan(otherPos);
        });
    });
});
