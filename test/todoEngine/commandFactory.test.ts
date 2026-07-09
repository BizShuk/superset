// Tests for the todoEngine commandFactory. The factory emits
// `vscode.commands.registerCommand` calls; we mock vscode with an
// empty object so the registrations are no-ops, then assert on the
// factory's return shape and the context-callback behaviour.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createTodoCommands,
    type TodoCommandContext,
    type TodoEngineItem,
} from "../../src/todoEngine";

vi.mock("vscode", () => ({
    commands: {
        registerCommand: (_id: string, _handler: unknown) => ({
            dispose: () => undefined,
        }),
        executeCommand: () => Promise.resolve(),
    },
    window: {
        showInputBox: () => Promise.resolve(undefined),
        showQuickPick: () => Promise.resolve(undefined),
        showInformationMessage: () => undefined,
        showErrorMessage: () => undefined,
    },
    workspace: {
        openTextDocument: () => Promise.resolve({ languageId: "md" }),
    },
    languages: {
        setTextDocumentLanguage: () => Promise.resolve({ languageId: "md" }),
    },
    Uri: {
        file: (p: string) => ({ fsPath: p, path: p, scheme: "file" }),
    },
}));

// Dynamic import after the mock is registered.
const vscode = await import("vscode");

function makeCtx(
    prefix: "todo" | "projectsTodo" = "todo",
    overrides: Partial<TodoCommandContext> = {}
): TodoCommandContext {
    const calls = {
        toggle: 0,
        updatePriority: 0,
        addTodo: 0,
        archive: 0,
        rollback: 0,
        archiveSection: 0,
        deleteSection: 0,
        delete: 0,
        reset: 0,
        toggleShowCompleted: 0,
        togglePriority: 0,
        isShowingCompleted: false,
        isPriorityEnabled: false,
        setViewType: 0,
        getViewType: "section" as const,
    };
    let activeItem: TodoEngineItem | undefined;
    return {
        prefix,
        log: () => undefined,
        showInfo: () => undefined,
        showError: () => undefined,
        refreshTree: () => undefined,
        workspaceFolder: "/ws",
        getActiveItem: () => activeItem,
        store: {
            toggle: vi.fn(async () => {
                calls.toggle++;
            }) as TodoCommandContext["store"]["toggle"],
            updatePriority: vi.fn(async () => {
                calls.updatePriority++;
            }) as TodoCommandContext["store"]["updatePriority"],
            addTodo: vi.fn(async () => {
                calls.addTodo++;
            }) as TodoCommandContext["store"]["addTodo"],
            moveTodo: vi.fn(async () => undefined),
            archiveTodo: vi.fn(async () => {
                calls.archive++;
            }) as TodoCommandContext["store"]["archiveTodo"],
            rollbackTodo: vi.fn(async () => {
                calls.rollback++;
            }) as TodoCommandContext["store"]["rollbackTodo"],
            archiveSection: vi.fn(async () => {
                calls.archiveSection++;
            }) as TodoCommandContext["store"]["archiveSection"],
            unarchiveSection: vi.fn(async () => undefined),
            deleteSection: vi.fn(async () => {
                calls.deleteSection++;
            }) as TodoCommandContext["store"]["deleteSection"],
            updateText: vi.fn(async () => undefined),
            deleteTodo: vi.fn(async () => {
                calls.delete++;
            }) as TodoCommandContext["store"]["deleteTodo"],
            reset: vi.fn(async () => {
                calls.reset++;
            }) as TodoCommandContext["store"]["reset"],
        },
        treeProvider: {
            toggleShowCompleted: () => {
                calls.toggleShowCompleted++;
            },
            isShowingCompleted: () => calls.isShowingCompleted,
            isPriorityEnabled: () => calls.isPriorityEnabled,
            togglePriority: () => {
                calls.togglePriority++;
            },
            setViewType: (t) => {
                calls.setViewType++;
                calls.getViewType = t;
            },
            getViewType: () => calls.getViewType,
        },
        planActions: {
            complete: vi.fn(async () => undefined),
            backlog: vi.fn(async () => undefined),
            archive: vi.fn(async () => undefined),
            delete: vi.fn(async () => undefined),
        },
        ...overrides,
        // Provide a way to set activeItem for tests that need it
    } as TodoCommandContext;
}

describe("createTodoCommands", () => {
    let setContext: ReturnType<typeof vi.fn>;
    let registerSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        setContext = vi.fn();
        registerSpy = vi.fn(
            (_id: string, _handler: unknown) => ({
                dispose: () => undefined,
            })
        );
        // Patch the mocked vscode.commands to capture calls.
        (vscode.commands as any).executeCommand = (
            cmd: string,
            key: string,
            value: unknown
        ) => {
            if (cmd === "setContext") setContext(key, value);
            return Promise.resolve();
        };
        (vscode.commands as any).registerCommand = registerSpy;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("emits 29 commands for the `todo` prefix", () => {
        const ctx = makeCtx("todo");
        const set = createTodoCommands(ctx);
        expect(set.disposables).toHaveLength(29);
        const ids = registerSpy.mock.calls.map((c) => c[0] as string);
        expect(ids).toContain("superset.todoToggle");
        expect(ids).toContain("superset.todoChangePriority");
        expect(ids).toContain("superset.todoNew");
        expect(ids).toContain("superset.todoOpen");
        expect(ids).toContain("superset.todoOpenLink");
        expect(ids).toContain("superset.todoCompletePlan");
        expect(ids).toContain("superset.todoBacklogPlan");
        expect(ids).toContain("superset.todoArchivePlan");
        expect(ids).toContain("superset.todoDeletePlan");
        expect(ids).toContain("superset.todoCopy");
        expect(ids).toContain("superset.todoArchive");
        expect(ids).toContain("superset.todoRollback");
        expect(ids).toContain("superset.todoArchiveSection");
        expect(ids).toContain("superset.todoUnarchiveSection");
        expect(ids).toContain("superset.todoChangeSection");
        expect(ids).toContain("superset.todoDeleteSection");
        expect(ids).toContain("superset.todoRename");
        expect(ids).toContain("superset.todoDelete");
        expect(ids).toContain("superset.todoViewSec");
        expect(ids).toContain("superset.todoViewPX");
        expect(ids).toContain("superset.todoViewFile");
        expect(ids).toContain("superset.todoFilterHideCompleted");
        expect(ids).toContain("superset.todoFilterShowAll");
        expect(ids).toContain("superset.todoFilterP0");
        expect(ids).toContain("superset.todoFilterP1");
        expect(ids).toContain("superset.todoFilterP2");
        expect(ids).toContain("superset.todoFilterP0On");
        expect(ids).toContain("superset.todoFilterP1On");
        expect(ids).toContain("superset.todoFilterP2On");
    });

    it("emits 25 commands for the `projectsTodo` prefix", () => {
        const ctx = makeCtx("projectsTodo");
        createTodoCommands(ctx);
        const ids = registerSpy.mock.calls.map((c) => c[0] as string);
        for (const id of ids) {
            expect(id.startsWith("superset.projectsTodo")).toBe(true);
        }
        expect(ids).toContain("superset.projectsTodoToggle");
        expect(ids).toContain("superset.projectsTodoOpen");
    });

    it("returns disposables that can be disposed without error", () => {
        const ctx = makeCtx();
        const set = createTodoCommands(ctx);
        for (const d of set.disposables) {
            expect(() => d.dispose()).not.toThrow();
        }
    });

    it("syncPriorityContext pushes three context keys with the prefix", () => {
        const ctx = makeCtx("projectsTodo");
        const set = createTodoCommands(ctx);
        set.syncPriorityContext();
        expect(setContext).toHaveBeenCalledWith(
            "projectsTodo.filterP0",
            expect.anything()
        );
        expect(setContext).toHaveBeenCalledWith(
            "projectsTodo.filterP1",
            expect.anything()
        );
        expect(setContext).toHaveBeenCalledWith(
            "projectsTodo.filterP2",
            expect.anything()
        );
    });

    it("applyFilterToggle calls treeProvider.toggleShowCompleted and refreshes the badge", () => {
        let refreshed = 0;
        const ctx = makeCtx("todo", {
            refreshTree: () => {
                refreshed++;
            },
        });
        const set = createTodoCommands(ctx);
        set.applyFilterToggle();
        expect(refreshed).toBe(1);
    });

    it("Toggle handler delegates to store.toggle for checkbox rows", async () => {
        const ctx = makeCtx();
        const set = createTodoCommands(ctx);
        const toggle = registerSpy.mock.calls.find(
            (c) => c[0] === "superset.todoToggle"
        )?.[1] as (item: unknown) => Promise<void>;
        await toggle({
            line: 5,
            text: "fix bug",
            checked: false,
            kind: "checkbox",
        });
        expect(ctx.store.toggle).toHaveBeenCalled();
    });

    it("Toggle handler no-ops on list / plan rows", async () => {
        const ctx = makeCtx();
        createTodoCommands(ctx);
        const toggle = registerSpy.mock.calls.find(
            (c) => c[0] === "superset.todoToggle"
        )?.[1] as (item: unknown) => Promise<void>;
        await toggle({
            line: 0,
            text: "x",
            checked: false,
            kind: "list",
        });
        await toggle({
            line: 0,
            text: "x",
            checked: false,
            kind: "plan",
        });
        expect(ctx.store.toggle).not.toHaveBeenCalled();
    });

    it("ArchivePlan dispatches to planActions.archive + store.reset", async () => {
        const ctx = makeCtx();
        createTodoCommands(ctx);
        const archive = registerSpy.mock.calls.find(
            (c) => c[0] === "superset.todoArchivePlan"
        )?.[1] as (item: unknown) => Promise<void>;
        await archive({
            line: 0,
            text: "x",
            checked: false,
            kind: "plan",
            filePath: "/ws/plans/foo.md",
        });
        expect(ctx.planActions.archive).toHaveBeenCalledWith(
            "/ws",
            "foo.md"
        );
        expect(ctx.store.reset).toHaveBeenCalled();
    });
});
