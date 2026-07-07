import type { TodoItem } from "../todo/types";

/**
 * 繼承自 `TodoItem` 的多專案待辦項目，額外攜帶專案名稱與路徑，
 * 以便在全域命令處理時識別該項目所屬的專案。
 */
export interface ProjectTodoItem extends TodoItem {
    readonly projectName: string;
    readonly projectPath: string;
    children?: ProjectTodoItem[];
}

export type ProjectsTodoChange =
    | { type: "loaded" }
    | { type: "toggled"; item: ProjectTodoItem };

export type ProjectsTodoListener = (change: ProjectsTodoChange) => void;
