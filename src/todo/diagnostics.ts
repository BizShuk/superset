import type { TodoItem } from "./types";

/** Count actionable checkbox tasks across the complete TODO tree. */
export function countTodoTasks(items: readonly TodoItem[]): number {
    let count = 0;
    for (const item of items) {
        if (item.kind === "checkbox") count += 1;
        if (item.children) count += countTodoTasks(item.children);
    }
    return count;
}
