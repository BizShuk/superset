// editorLayoutPlugin — activation contract against a vscode fake.
//
// The sharpest assertion here is the `viewColumn` one: VS Code resolves
// a view column through the GRID_APPEARANCE group order, which is the
// same depth-first walk that produces a layout descriptor, while
// `tabGroups.all` is ordered by group CREATION. The fixture below makes
// the two disagree on purpose — indexing by `all.indexOf` would enlarge
// the wrong group.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
    commands: new Map<string, (...args: unknown[]) => unknown>(),
    executed: [] as Array<{ command: string; arg: unknown }>,
    disposed: 0,
    listeners: [] as Array<() => void>,
    configListeners: [] as Array<(event: unknown) => void>,
    layout: {
        orientation: 0 as 0 | 1,
        groups: [
            { size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] },
        ],
    } as unknown,
    tabs: {
        // Creation order deliberately differs from grid order: the
        // active group sits last in `all` but is view column 2.
        all: [{ viewColumn: 3 }, { viewColumn: 1 }, { viewColumn: 4 }, { viewColumn: 2 }],
        active: { viewColumn: 2 },
    },
    config: {
        maxRatio: 0.7,
        defaultShape: "flat",
        followActiveGroup: true,
        restoreOnActivate: true,
    } as Record<string, unknown>,
}));

vi.mock("vscode", () => ({
    StatusBarAlignment: { Left: 1, Right: 2 },
    window: {
        get tabGroups() {
            return {
                all: state.tabs.all,
                activeTabGroup: state.tabs.active,
                onDidChangeTabGroups: (cb: () => void) => {
                    state.listeners.push(cb);
                    return { dispose: () => state.disposed++ };
                },
            };
        },
        onDidChangeActiveTextEditor: (cb: () => void) => {
            state.listeners.push(cb);
            return { dispose: () => state.disposed++ };
        },
        showQuickPick: async () => undefined,
        showInformationMessage: () => undefined,
    },
    commands: {
        registerCommand: (
            id: string,
            handler: (...args: unknown[]) => unknown
        ) => {
            state.commands.set(id, handler);
            return { dispose: () => state.disposed++ };
        },
        executeCommand: async (command: string, arg?: unknown) => {
            state.executed.push({ command, arg });
            return command === "vscode.getEditorLayout"
                ? state.layout
                : undefined;
        },
    },
    workspace: {
        getConfiguration: () => ({
            get: (key: string) => state.config[key],
        }),
        onDidChangeConfiguration: (cb: (event: unknown) => void) => {
            state.configListeners.push(cb);
            return { dispose: () => state.disposed++ };
        },
    },
}));

const { editorLayoutPlugin, EDITOR_LAYOUT_COMMANDS, EDITOR_LAYOUT_PLUGIN_ID } =
    await import("../src/editorLayout/plugin");
const { readActiveIndex } = await import("../src/editorLayout/applyLayout");

function makeContext() {
    const store: Record<string, unknown> = {};
    const disposables: Array<{ dispose(): void }> = [];
    const resetHandlers: Array<() => void | Promise<void>> = [];
    return {
        disposables,
        resetHandlers,
        store,
        logs: [] as string[],
        ctx: {
            workspaceFolder: "/tmp/workspace",
            extensionUri: {} as never,
            globalState: {
                get: <T>(key: string) => store[key] as T | undefined,
                update: async (key: string, value: unknown) => {
                    store[key] = value;
                },
            },
            workspaceState: {
                get: <T>(key: string) => store[key] as T | undefined,
                update: async (key: string, value: unknown) => {
                    store[key] = value;
                },
            },
            log(message: string) {
                this.logs?.push(message);
            },
            showLogs: () => undefined,
            createTerminal: () => ({}) as never,
            registerDisposable: (d: { dispose(): void }) => disposables.push(d),
            registerResetHandler: (h: () => void | Promise<void>) =>
                resetHandlers.push(h),
            resetAll: async () => undefined,
            registerDiagnosticsProvider: () => undefined,
            getRuntimeDiagnostics: () => ({ activePluginIds: [], metrics: {} }),
            registerTreeView: () => undefined,
            revealInTree: async () => false,
        },
    };
}

const setLayoutCalls = () =>
    state.executed.filter((call) => call.command === "vscode.setEditorLayout");

/** Fire every grid listener and let the debounce elapse. */
async function emitGridChange(): Promise<void> {
    for (const listener of state.listeners) listener();
    await vi.advanceTimersByTimeAsync(200);
}

beforeEach(() => {
    state.commands.clear();
    state.executed.length = 0;
    state.listeners.length = 0;
    state.configListeners.length = 0;
    state.disposed = 0;
    state.tabs.all = [
        { viewColumn: 3 },
        { viewColumn: 1 },
        { viewColumn: 4 },
        { viewColumn: 2 },
    ];
    state.tabs.active = { viewColumn: 2 };
    state.config = {
        maxRatio: 0.7,
        defaultShape: "flat",
        followActiveGroup: true,
        restoreOnActivate: true,
    };
    state.layout = {
        orientation: 0,
        groups: [
            { size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] },
        ],
    };
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("editorLayoutPlugin identity", () => {
    it("exposes a stable id and name", () => {
        expect(editorLayoutPlugin.id).toBe(EDITOR_LAYOUT_PLUGIN_ID);
        expect(editorLayoutPlugin.id).toBe("editorLayout");
        expect(editorLayoutPlugin.name).toBe("Editor Layout");
    });

    it("does not contribute a markdown-it hook", () => {
        expect(editorLayoutPlugin.contributeMarkdownIt).toBeUndefined();
    });

    it("defines deactivate as a lifecycle hint", () => {
        expect(typeof editorLayoutPlugin.deactivate).toBe("function");
    });
});

describe("readActiveIndex", () => {
    it("uses viewColumn - 1, not the tab-group array order", () => {
        // `all.indexOf(active)` would be 3 here; the grid index is 1.
        expect(state.tabs.all.indexOf(state.tabs.active)).toBe(-1);
        expect(readActiveIndex()).toBe(1);

        state.tabs.active = { viewColumn: 4 };
        expect(readActiveIndex()).toBe(3);
    });

    it("falls back to the first group when no column is available", () => {
        state.tabs.active = { viewColumn: undefined as unknown as number };
        expect(readActiveIndex()).toBe(0);
    });
});

describe("editorLayoutPlugin activation", () => {
    it("registers exactly the four commands it owns", async () => {
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);

        const expected = Object.values(EDITOR_LAYOUT_COMMANDS);
        expect(expected).toHaveLength(4);
        for (const command of expected) {
            expect(state.commands.has(command), command).toBe(true);
        }
    });

    it("owns no status bar item", async () => {
        // The vscode fake has no `createStatusBarItem`, so activating
        // at all is the assertion: touching one would throw.
        const harness = makeContext();
        await expect(
            editorLayoutPlugin.activate(harness.ctx as never)
        ).resolves.toBeUndefined();
        await vi.advanceTimersByTimeAsync(100);
    });

    it("persists nothing — the rule is fixed, not remembered", async () => {
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.refresh)!();
        await state.commands.get(EDITOR_LAYOUT_COMMANDS.transpose)!();

        expect(Object.keys(harness.store)).toHaveLength(0);
    });

    it("registers a reset handler and disposables for every resource", async () => {
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);

        expect(harness.resetHandlers).toHaveLength(1);
        // 4 commands + 3 listeners + the timer guard.
        expect(harness.disposables.length).toBeGreaterThanOrEqual(8);
        for (const disposable of harness.disposables) disposable.dispose();
    });

    it("applies on activation without reshaping or reorienting", async () => {
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);

        await vi.advanceTimersByTimeAsync(100);

        const writes = setLayoutCalls();
        expect(writes).toHaveLength(1);
        const applied = writes[0].arg as {
            orientation: number;
            groups: Array<{ groups?: unknown[] }>;
        };
        expect(applied.orientation).toBe(0);
        expect(applied.groups).toHaveLength(2);
        expect(applied.groups.every((n) => n.groups?.length === 2)).toBe(true);
    });

    it("lays out columns evenly and heightens the active row", async () => {
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);

        const applied = setLayoutCalls()[0].arg as {
            groups: Array<{ size: number; groups: Array<{ size: number }> }>;
        };
        const share = (nodes: Array<{ size: number }>, i: number) =>
            nodes[i].size / nodes.reduce((sum, n) => sum + n.size, 0);

        expect(share(applied.groups, 0)).toBeCloseTo(0.5, 2);
        // Active group is view column 2 — the second row of column one.
        expect(share(applied.groups[0].groups, 1)).toBeCloseTo(0.7, 2);
        expect(share(applied.groups[1].groups, 0)).toBeCloseTo(0.5, 2);
    });

    it("skips the activation apply when the setting is off", async () => {
        state.config.restoreOnActivate = false;
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);

        await vi.advanceTimersByTimeAsync(100);
        expect(setLayoutCalls()).toHaveLength(0);
    });

    it("transposes the grid without persisting anything", async () => {
        state.config.restoreOnActivate = false;
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.transpose)!();

        const applied = setLayoutCalls().at(-1)!.arg as {
            orientation: number;
        };
        expect(applied.orientation).toBe(1);
    });

    it("re-applies on demand, past the signature guard", async () => {
        state.config.restoreOnActivate = false;
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);
        const before = setLayoutCalls().length;

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.refresh)!();
        await state.commands.get(EDITOR_LAYOUT_COMMANDS.refresh)!();

        // Nothing about the grid moved, so the guard would have
        // swallowed both writes — a refresh must get through anyway.
        expect(setLayoutCalls().length).toBe(before + 2);
    });

    it("re-applies when an editorLayout setting changes", async () => {
        state.config.restoreOnActivate = false;
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);
        const before = setLayoutCalls().length;

        state.config.maxRatio = 0.9;
        for (const listener of state.configListeners) {
            listener({
                affectsConfiguration: (section: string) =>
                    section === "superset.editorLayout",
            });
        }
        await vi.advanceTimersByTimeAsync(100);

        expect(setLayoutCalls().length).toBe(before + 1);
    });

    it("ignores configuration changes outside its own section", async () => {
        state.config.restoreOnActivate = false;
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);
        const before = setLayoutCalls().length;

        for (const listener of state.configListeners) {
            listener({ affectsConfiguration: () => false });
        }
        await vi.advanceTimersByTimeAsync(100);

        expect(setLayoutCalls().length).toBe(before);
    });

    it("follows the active group when focus moves", async () => {
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);
        const before = setLayoutCalls().length;

        state.tabs.active = { viewColumn: 4 };
        await emitGridChange();

        expect(setLayoutCalls().length).toBeGreaterThan(before);
    });

    it("writes nothing on an event that changes no sizes", async () => {
        // The guard is what stops `setEditorLayout` — which itself
        // fires the tab-group event — from looping forever.
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);
        const before = setLayoutCalls().length;

        await emitGridChange();

        expect(setLayoutCalls().length).toBe(before);
    });

    it("does not follow focus when the setting is off", async () => {
        state.config.restoreOnActivate = false;
        state.config.followActiveGroup = false;
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);
        const before = setLayoutCalls().length;

        state.tabs.active = { viewColumn: 4 };
        await emitGridChange();

        expect(setLayoutCalls().length).toBe(before);
    });

    it("writes nothing without editor groups", async () => {
        state.tabs.all = [];
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);

        expect(setLayoutCalls()).toHaveLength(0);
    });

    it("survives a failing getEditorLayout without writing a layout", async () => {
        state.layout = { bogus: true };
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);

        expect(setLayoutCalls()).toHaveLength(0);
    });
});
