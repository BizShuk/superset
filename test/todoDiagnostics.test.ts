import { describe, expect, it } from "vitest";
import { countTodoTasks } from "../src/todo/diagnostics";
import type { TodoItem } from "../src/todo/types";

describe("countTodoTasks", () => {
    it("counts nested checkbox tasks but excludes notes, sections, and plans", () => {
        const items: TodoItem[] = [
            {
                line: 1,
                text: "Section",
                checked: false,
                kind: "section",
                children: [
                    {
                        line: 2,
                        text: "Open task",
                        checked: false,
                        kind: "checkbox",
                        children: [
                            {
                                line: 3,
                                text: "Completed nested task",
                                checked: true,
                                kind: "checkbox",
                            },
                        ],
                    },
                    {
                        line: 4,
                        text: "Free-form note",
                        checked: false,
                        kind: "list",
                    },
                    {
                        line: 0,
                        text: "Implementation plan",
                        checked: false,
                        kind: "plan",
                        filePath: "/workspace/plans/plan.md",
                    },
                ],
            },
        ];

        expect(countTodoTasks(items)).toBe(2);
    });
});
