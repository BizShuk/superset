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
     * "section"  = `##+` heading or a synthetic group header (e.g.
     *              "Default", "Plans", priority/file view groups).
     * "plan"     = read-only entry synthesised by scanning the
     *              workspace's `plans/*.md` folder (see
     *              `plansSource.ts`). `filePath` MUST be set so the
     *              menu-driven `openPlan` command can resolve the
     *              absolute path; `checked` is always `false`.
     */
    readonly kind: "checkbox" | "list" | "section" | "plan";
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
    /**
     * Absolute path on disk. Only set for `kind: "plan"` items —
     * required there so the tree provider's openPlan menu command
     * knows which `.md` file to preview.
     */
    readonly filePath?: string;
}

/**
 * 帶有 sub-project 歸屬的 `TodoItem`。TODO 面板遞迴掃描 workspace,
 * 每個含 `README.todo` 的資料夾是一個 sub-project,列上的命令要靠
 * `projectPath` 找回對應的 `TodoStore`。
 *
 * 合成的 wrapper row(priority / file group、workspace section)沒有
 * 對應單一 sub-project,`projectName` 設為 `"<workspace>"` 並把
 * `projectPath` 留空字串 — 命令處理端(例如 `openProject`)必須先
 * null-check `projectPath` 才使用。
 */
export interface WorkspaceTodoItem extends TodoItem {
    readonly projectName: string;
    readonly projectPath: string;
    children?: WorkspaceTodoItem[];
}

export type WorkspaceTodoChange =
    | { type: "loaded" }
    | { type: "toggled"; item: WorkspaceTodoItem };

export type WorkspaceTodoListener = (change: WorkspaceTodoChange) => void;

export type TodoViewType = "section" | "priority" | "file";

export type TodoChange =
    | { type: "loaded"; items: TodoItem[] }
    | { type: "toggled"; item: TodoItem };

export type TodoListener = (change: TodoChange) => void;
