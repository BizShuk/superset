// Recursively count unchecked checkbox items under a section or
// project row. Children arriving at a row have already been filtered
// by `filterCompleted` and `applyPriorityFilter`, so the count
// naturally excludes archived / completed items when the
// hide-completed filter is active and respects the active priority
// filter.
//
// Used by both `src/todo/todoTreeProvider.ts` and
// `src/projectsTodo/projectsTodoTreeProvider.ts` to compute the
// "N pending" / "N ◐" badge on section headers.

import type { TodoEngineItem } from "./types";

interface CountableItem extends TodoEngineItem {
    children?: CountableItem[];
}

export function countPending<T extends CountableItem>(items?: T[]): number {
    if (!items || items.length === 0) return 0;
    let count = 0;
    for (const item of items) {
        if (item.kind === "checkbox" && !item.checked) {
            count++;
        }
        if (item.children) {
            count += countPending(item.children as T[]);
        }
    }
    return count;
}