// Todo-feature domain types.

export interface TodoItem {
    readonly line: number;
    readonly text: string;
    readonly description?: string;
    /**
     * "checkbox" = `- [ ]` / `- [x]` line; can be toggled.
     * "list"     = `- foo` / `* bar` / `+ baz` line **without** the
     *              `[ ]` checkbox marker. Rendered as a non-togglable
     *              tree node so the panel mirrors the file's list
     *              structure for free-form notes interleaved with
     *              actionable items. `checked` is always `false` for
     *              list items.
     */
    readonly kind: "checkbox" | "list" | "section";
    checked: boolean;
    children?: TodoItem[];
    /**
     * Heading depth for `kind: "section"` items parsed from a real
     * `##+` line (2 = `##`, 3 = `###`, ...). `undefined` for the
     * synthetic "Default" section and for the priority/file view's
     * synthetic groups, which have no corresponding heading line.
     */
    readonly level?: number;
    parentSection?: string;
}

export type TodoViewType = "section" | "priority" | "file";

export type TodoChange =
    | { type: "loaded"; items: TodoItem[] }
    | { type: "toggled"; item: TodoItem };

export type TodoListener = (change: TodoChange) => void;
