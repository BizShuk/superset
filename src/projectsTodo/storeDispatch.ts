import type { TodoEngineItem } from "../todoEngine";

export type TodoStoreMutation =
    | "toggle"
    | "updatePriority"
    | "archiveTodo"
    | "rollbackTodo"
    | "moveTodo"
    | "deleteTodo"
    | "updateText"
    | "archiveSection"
    | "unarchiveSection"
    | "deleteSection";

/**
 * Dispatch a mutation on a per-project TodoStore without losing its receiver.
 * TodoStore methods access instance-owned state such as `repository`; calling
 * an extracted method as a bare function makes `this` undefined in strict mode.
 */
export async function invokeTodoStoreMutation(
    store: object,
    kind: TodoStoreMutation,
    item: TodoEngineItem,
    ...rest: unknown[]
): Promise<void> {
    const method = (store as Record<string, unknown>)[kind];
    if (typeof method !== "function") return;
    await (method as (...args: unknown[]) => unknown).call(
        store,
        item,
        ...rest,
    );
}
