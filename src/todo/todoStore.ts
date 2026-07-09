// TodoStore — pure in-memory state holder. Owns the parsed `TodoItem[]`
// snapshot and an observer-pattern listener set. All filesystem I/O
// flows through `TodoRepository`; the parsing algorithm lives in
// `./parser`. The store's public surface is unchanged from before
// the refactor — see the existing 23-case test suite for the contract.

import type { TodoChange, TodoItem, TodoListener } from "./types";
import { TodoRepository } from "./repository";
import { scanPlans, type PlanInfo } from "./plansSource";
import {
    ensureArchiveIsLastSection,
    type TodoStoreContext,
} from "./todoBlockOps";
import {
    toggleTodo,
    updatePriority,
    updateText,
    deleteTodo,
} from "./todoMutations";
import {
    archiveSection,
    unarchiveSection,
    deleteSection,
} from "./todoSectionOps";
import {
    moveTodo,
    addTodo,
    archiveTodo,
    rollbackTodo,
} from "./todoMoveOps";

/**
 * Pure data layer for the TODO list.
 * Reads/Writes a markdown file with checkbox items via the injected
 * `TodoRepository`. Uses the observer pattern (same as TerminalRegistry).
 *
 * As of 0.8.4 the store also keeps a parallel snapshot of the
 * workspace's `plans/*.md` folder (see `plansSource.ts`). Plans are
 * surfaced as read-only entries under a synthetic `## Plans`
 * section by the tree provider; this store only caches the raw
 * `PlanInfo[]` and exposes it via `getPlanItems()`.
 */
export class TodoStore {
    private items: TodoItem[] = [];
    private planItems: PlanInfo[] = [];
    private listeners = new Set<TodoListener>();
    /**
     * Repository handle, exposed for the extracted ops functions
     * (`todoMutations` / `todoSectionOps` / `todoMoveOps`) that need
     * direct read access. Read-only — ops modules should never
     * mutate the repository reference; they go through `writeAndLoad`.
     */
    public readonly repository: TodoRepository;
    private readonly workspaceRoot: string;

    constructor(workspaceRoot: string, repository?: TodoRepository) {
        // Allow tests to inject a mock repository in the future; the
        // default builds a real one bound to the workspace root.
        this.repository = repository ?? new TodoRepository(workspaceRoot);
        this.workspaceRoot = workspaceRoot;
    }

    getItems(): TodoItem[] {
        return this.items;
    }

    /**
     * Cached scan result for the workspace's `plans/` folder.
     * Returns an empty array when `plans/` does not exist or is
     * unreadable — see `scanPlans()` in `plansSource.ts`.
     */
    getPlanItems(): PlanInfo[] {
        return this.planItems;
    }

    getCompletedCount(): number {
        let count = 0;
        const traverse = (items: TodoItem[]): void => {
            for (const item of items) {
                if (item.checked) count++;
                if (item.children) traverse(item.children);
            }
        };
        traverse(this.items);
        return count;
    }

    async reset(): Promise<void> {
        await this.load();
    }

    async load(): Promise<void> {
        // Read both the README.todo and the plans/ folder in parallel;
        // they live in different parts of the filesystem so there's no
        // ordering benefit to sequencing them. Either failing returns
        // an empty result (see `TodoRepository.read` / `scanPlans`),
        // so a missing file in one never blocks the other.
        const [result, plans] = await Promise.all([
            this.repository.read(),
            scanPlans(this.workspaceRoot),
        ]);
        if (result.items === null) {
            // File missing — emit an empty snapshot so listeners can
            // re-render into a blank state.
            this.items = [];
            this.planItems = plans;
            this.emit({ type: "loaded", items: [] });
            return;
        }
        this.items = result.items;
        this.planItems = plans;
        this.emit({ type: "loaded", items: result.items });
    }

    async toggle(item: TodoItem): Promise<void> {
        return toggleTodo(this, item);
    }

    async updatePriority(
        item: TodoItem,
        newPriority: "P0" | "P1" | "P2" | "None"
    ): Promise<void> {
        return updatePriority(this, item, newPriority);
    }

    async addTodo(text: string, sectionName: string): Promise<void> {
        return addTodo(this, text, sectionName);
    }

    async moveTodo(item: TodoItem, sectionName: string): Promise<void> {
        return moveTodo(this, item, sectionName);
    }

    async archiveTodo(item: TodoItem): Promise<void> {
        return archiveTodo(this, item);
    }

    async rollbackTodo(item: TodoItem): Promise<void> {
        return rollbackTodo(this, item);
    }

    async archiveSection(item: TodoItem): Promise<void> {
        return archiveSection(this, item);
    }

    async unarchiveSection(item: TodoItem): Promise<void> {
        return unarchiveSection(this, item);
    }

    async deleteSection(item: TodoItem): Promise<void> {
        return deleteSection(this, item);
    }

    async updateText(line: number, newText: string): Promise<void> {
        return updateText(this, line, newText);
    }

    async deleteTodo(item: TodoItem): Promise<void> {
        return deleteTodo(this, item);
    }

    onDidChange(listener: TodoListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Emit a change to all listeners. Public so the extracted ops
     * functions (`todoMutations.toggle`) can fire a `"toggled"` event
     * on the optimized path that bypasses `writeAndLoad` for
     * non-archive items.
     */
    emit(change: TodoChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }

    /**
     * Write lines to disk, ensure Archive is last, and reload the
     * in-memory snapshot. The standard write path used by every
     * mutation that needs the post-write state to be re-rendered.
     * Public for the same reason as `emit`.
     */
    async writeAndLoad(lines: string[]): Promise<void> {
        const cleanedLines = ensureArchiveIsLastSection(lines);
        await this.repository.write(cleanedLines.join("\n"));
        await this.load();
    }
}
