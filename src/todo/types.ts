// Todo-feature domain types.

export interface TodoItem {
    readonly line: number;
    readonly text: string;
    /**
     * "checkbox" = `- [ ]` / `- [x]` line; can be toggled.
     * "list"     = `- foo` / `* bar` / `+ baz` line **without** the
     *              `[ ]` checkbox marker. Rendered as a non-togglable
     *              tree node so the panel mirrors the file's list
     *              structure for free-form notes interleaved with
     *              actionable items. `checked` is always `false` for
     *              list items.
     */
    readonly kind: "checkbox" | "list";
    checked: boolean;
    children?: TodoItem[];
}

export type TodoChange =
    | { type: "loaded"; items: TodoItem[] }
    | { type: "toggled"; item: TodoItem };

export type TodoListener = (change: TodoChange) => void;
