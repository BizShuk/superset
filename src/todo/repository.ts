// TodoRepository — owns all filesystem I/O for `README.todo`. Splits
// the read / write concerns out of `TodoStore` so the store can be
// tested without touching the disk and so the watcher's infinite-loop
// guard (hash compare) lives next to the writer that would otherwise
// re-trigger it.
//
// The store receives parsed `TodoItem[]` from `parseTodoFile(...)` and
// sends back serialised text via `write(...)` — this module never
// inspects todo semantics, it only shuttles strings.

import { readFile, writeFile } from "fs/promises";
import { parseTodoFile } from "./parser";
import type { TodoItem } from "./types";

const TODO_FILE = "README.todo";

export interface ReadResult {
    /** Parsed items, or `null` when the file is missing. */
    items: TodoItem[] | null;
    /** Raw text read from disk (empty string when missing). */
    content: string;
}

export class TodoRepository {
    constructor(private readonly workspaceRoot: string) {}

    /** Absolute path of the `README.todo` file under the workspace. */
    get filePath(): string {
        return `${this.workspaceRoot}/${TODO_FILE}`;
    }

    /**
     * Read & parse the file. Returns `{ items: null, content: "" }`
     * when the file does not exist — the store maps that to an empty
     * `TodoItem[]` and emits a "loaded" change so the UI clears.
     */
    async read(): Promise<ReadResult> {
        let content: string;
        try {
            content = await readFile(this.filePath, "utf-8");
        } catch {
            return { items: null, content: "" };
        }
        return { items: parseTodoFile(content), content };
    }

    /** Write the supplied content back to disk. */
    async write(content: string): Promise<void> {
        await writeFile(this.filePath, content, "utf-8");
    }

    /**
     * Convenience: read & return parsed items, or `[]` when missing.
     * Used by `TodoStore.load()` which only needs the AST and handles
     * the "missing file" case itself by emitting an empty `loaded`.
     */
    async readItems(): Promise<TodoItem[]> {
        const result = await this.read();
        return result.items ?? [];
    }
}
