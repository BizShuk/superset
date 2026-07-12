// Sort siblings so unchecked items precede checked items. The
// grouping only applies when every sibling is a checkbox — mixed
// kinds (sections + leaves) are returned untouched so section
// headers keep their authored order.
//
// Used by `getChildren` in both `todoTreeProvider` and
// `projectsTodoTreeProvider` when expanding a section's children.

import type { TodoEngineItem } from "./types";

export function sortSiblings<T extends TodoEngineItem>(items: T[]): T[] {
    if (items.length === 0) return items;
    const allCheckboxes = items.every((t) => t.kind === "checkbox");
    if (!allCheckboxes) return items;
    return [
        ...items.filter((t) => !t.checked),
        ...items.filter((t) => t.checked),
    ];
}