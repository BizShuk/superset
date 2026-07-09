import type { TodoItem } from "../todo/types";

/**
 * 繼承自 `TodoItem` 的多專案待辦項目，額外攜帶專案名稱與路徑，
 * 以便在全域命令處理時識別該項目所屬的專案。
 *
 * Top-level 的「Plans」row 沒有對應單一 project,`projectName` 設為
 * `"<workspace>"` 並把 `projectPath` 留空字串 — 命令處理端 (例如
 * `openProject`) 必須先 null-check `projectPath` 才使用。
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
