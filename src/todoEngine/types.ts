// todoEngine — shared types and contracts for the TODO panel. The
// module captures the panel's *command surface* (command names,
// handler shapes, filter model) so a single factory emits every
// `superset.todo*` command from one place.

/** Namespace prefix. Mirrors package.json's `superset.todo*` command
 *  IDs. */
export type CommandPrefix = "todo";

/** VSCode TreeView id for the panel. */
export type ViewId = "superset.todo";

/** Plan lifecycle action names. Mapped to `superset.<prefix>CompletePlan`
 *  / `BacklogPlan` / `ArchivePlan` / `DeletePlan` command ids. */
export type PlanActionKind = "complete" | "backlog" | "archive" | "delete";

/** Row kind coming through the TreeView callback. The `plan` kind is
 *  for read-only entries
 *  surfaced from `plans/*.md`; `section` is a heading row used to
 *  anchor the inline "+" / "Open" buttons. */
export type ItemKind =
    | "checkbox"
    | "checkboxWithLink"
    | "checkboxArchived"
    | "checkboxWithLinkArchived"
    | "list"
    | "listWithLink"
    | "listArchived"
    | "listWithLinkArchived"
    | "section"
    | "sectionArchivable"
    | "sectionArchived"
    | "plan"
    | "project";

/** Common row shape used by the factories. Both panels' row types
 *  narrow to this at the command boundary. */
export interface TodoEngineItem {
    line: number;
    text: string;
    checked: boolean;
    kind: ItemKind;
    parentSection?: string;
    level?: number;
    filePath?: string;
    projectPath?: string;
}

/** Context the commandFactory needs to emit the right command IDs
 *  with the right handlers. Each panel provides its own implementation
 *  by wiring its store / treeProvider into the matching fields. */
export interface TodoCommandContext {
    /** Namespace — "todo". Determines command ID prefix in the
     *  format `superset.${prefix}<Suffix>`. */
    prefix: CommandPrefix;

    /** Store adapter — `toggle`, `updatePriority`, `addTodo`, etc.
     *  Each panel wires its TodoStore or subStore dispatcher here. */
    store: TodoCommandStore;

    /** Filter + view-type controls on the TreeView. */
    treeProvider: TodoCommandTreeProvider;

    /** The currently selected item, if any. Most commands take the
     *  active item as their first argument; the menu wiring passes
     *  the clicked row at click time and this getter is the
     *  fallback for command-palette invocations. */
    getActiveItem(): TodoEngineItem | undefined;

    /** Plan lifecycle handlers — backed by `planActions.ts`. */
    planActions: TodoCommandPlanActions;

    /** Misc — logging + workspace path for opening README.todo. */
    log: (msg: string) => void;
    workspaceFolder: string;

    /** Optional reporters. Used by plan-action error mapping and
     *  the diagnostic channel. */
    reportPlanActionError?: (
        action: PlanActionKind,
        basename: string,
        err: unknown
    ) => void;

    /** Show a one-line info message. */
    showInfo: (msg: string) => void;
    showError: (msg: string) => void;

    /** Refresh the tree after a mutation. */
    refreshTree(): void;
}

export interface TodoCommandStore {
    toggle(item: TodoEngineItem): Promise<void>;
    updatePriority(
        item: TodoEngineItem,
        priority: "P0" | "P1" | "P2" | "None"
    ): Promise<void>;
    /**
     * Add a new todo row. `item` is the row that triggered the
     * command (a section row from the inline "+" button, or undefined
     * when invoked from the top-level nav). The single-workspace
     * panel ignores `item`; the multi-project panel uses
     * `item.projectPath` to skip the project picker.
     */
    addTodo(
        item: TodoEngineItem | undefined,
        text: string,
        sectionName: string,
    ): Promise<void>;
    /**
     * Open a `README.todo` in the markdown preview. The
     * single-workspace panel opens `<workspaceFolder>/README.todo`
     * unconditionally; the multi-project panel resolves
     * `item.projectPath` or prompts the user to pick one.
     */
    openTodoFile(item: TodoEngineItem | undefined): Promise<void>;
    moveTodo(item: TodoEngineItem, sectionName: string): Promise<void>;
    archiveTodo(item: TodoEngineItem): Promise<void>;
    rollbackTodo(item: TodoEngineItem): Promise<void>;
    archiveSection(item: TodoEngineItem): Promise<void>;
    unarchiveSection(item: TodoEngineItem): Promise<void>;
    deleteSection(item: TodoEngineItem): Promise<void>;
    updateText(line: number, newText: string): Promise<void>;
    deleteTodo(item: TodoEngineItem): Promise<void>;
    /** Read README.todo raw text — used by `openLink` for the plan
     *  case to derive the H1 title if needed. */
    reset?(): Promise<void>;
}

export interface TodoCommandTreeProvider {
    toggleShowCompleted(): void;
    isShowingCompleted(): boolean;
    isPriorityEnabled(priority: "P0" | "P1" | "P2"): boolean;
    togglePriority(priority: "P0" | "P1" | "P2"): void;
    /** View-type switching. Optional — panels that don't expose a
     *  view switch leave the factory's ViewSec/PX/File commands as
     *  no-ops. */
    setViewType?(viewType: "section" | "priority" | "file"): void;
    getViewType?(): "section" | "priority" | "file";
    /** Hidden / completed counts for the badge title. */
    getHiddenCount?(): number;
    /** Section names the user can move an item into. Used by the
     *  ChangeSection command's QuickPick. */
    getSectionList?(item: TodoEngineItem): string[];
}

export interface TodoCommandPlanActions {
    complete(workspaceRoot: string, basename: string): Promise<void>;
    backlog(workspaceRoot: string, basename: string): Promise<void>;
    archive(workspaceRoot: string, basename: string): Promise<void>;
    delete(workspaceRoot: string, basename: string): Promise<void>;
}

/** Public payload returned by the command factory. The caller
 *  (panel register()) is expected to add these to its disposable
 *  list so the manager can tear them down on deactivate. */
export interface TodoCommandSet {
    /** Every `superset.<prefix><X>` command registered with VSCode. */
    disposables: { dispose(): unknown }[];
    /** The single `applyFilterToggle` callable shared by both
     *  `filterHideCompleted` and `filterShowAll` commands. Returned
     *  separately so the caller can also wire it into the menu
     *  factory / view-title buttons if needed. */
    applyFilterToggle: () => void;
    /** Sync the priority context keys — used by both the priority
     *  filter buttons (in the menu factory) and the badge refresh. */
    syncPriorityContext: () => void;
    /** Refresh the filter badge title on the view. */
    refreshFilterBadge: () => void;
}
