// todoEngine — public surface. Both `src/todo/` and `src/projectsTodo/`
// import their factories from this barrel.
//
// Currently exposes:
//   - types: shared context / item / command contracts
//   - createTodoCommands: emits all 25 `superset.<prefix>*` commands
//
// Future factories (menuFactory, filterFactory, iconMap) will live as
// siblings and be re-exported here.

export type {
    CommandPrefix,
    ViewId,
    ItemKind,
    PlanActionKind,
    TodoEngineItem,
    TodoCommandContext,
    TodoCommandStore,
    TodoCommandTreeProvider,
    TodoCommandPlanActions,
    TodoCommandSet,
} from "./types";
export { createTodoCommands, planBasename } from "./commandFactory";
export { reportPlanActionError } from "./reportPlanActionError";
export { countPending } from "./countPending";
export { sortSiblings } from "./sortSiblings";
export {
    extractPriorityTag,
    stripMarkdownLink,
    priorityIconPath,
    type PriorityTag,
} from "./labelRenderer";
export {
    dispatchContextValue,
    type DispatchContextValueInput,
    type ContextValueAxis,
} from "./contextValue";