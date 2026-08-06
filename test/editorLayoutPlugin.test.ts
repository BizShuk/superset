// editorLayoutPlugin — activation contract against a vscode fake.
//
// The sharpest assertion here is the `viewColumn` one: VS Code resolves
// a view column through the GRID_APPEARANCE group order, which is the
// same depth-first walk that produces a layout descriptor, while
// `tabGroups.all` is ordered by group CREATION. The fixture below makes
// the two disagree on purpose — indexing by `all.indexOf` would enlarge
// the wrong group in `max` mode.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
    commands: new Map<string, (...args: unknown[]) => unknown>(),
    executed: [] as Array<{ command: string; arg: unknown }>,
    disposed: 0,
    listeners: [] as Array<() => void>,
    statusItem: {
        text: "",
        tooltip: "",
        command: "",
        shown: 0,
        hidden: 0,
        show(): void {
            this.shown++;
        },
        hide(): void {
            this.hidden++;
        },
        dispose(): void {
            state.disposed++;
        },
    },
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
        createStatusBarItem: () => state.statusItem,
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
    },
}));

const { editorLayoutPlugin, EDITOR_LAYOUT_COMMANDS, EDITOR_LAYOUT_PLUGIN_ID } =
    await import("../src/editorLayout/plugin");
const { readActiveIndex } = await import("../src/editorLayout/applyLayout");
const { EDITOR_LAYOUT_MODE_KEY } = await import(
    "../src/editorLayout/modeStorage"
);

function makeContext(stored: Record<string, unknown> = {}) {
    const store = { ...stored };
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

beforeEach(() => {
    state.commands.clear();
    state.executed.length = 0;
    state.listeners.length = 0;
    state.disposed = 0;
    state.statusItem.shown = 0;
    state.statusItem.hidden = 0;
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
        expect(editorLayoutPlugin.name).toBe("Editor Layout Modes");
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
    it("registers all eleven commands", async () => {
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);

        const expected = Object.values(EDITOR_LAYOUT_COMMANDS);
        expect(expected).toHaveLength(11);
        for (const command of expected) {
            expect(state.commands.has(command), command).toBe(true);
        }
    });

    it("wires the status bar to the mode picker", async () => {
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        expect(state.statusItem.command).toBe(EDITOR_LAYOUT_COMMANDS.pick);
    });

    it("registers a reset handler and disposables for every resource", async () => {
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);

        expect(harness.resetHandlers).toHaveLength(1);
        // 11 commands + status item + 2 listeners + the timer guard.
        expect(harness.disposables.length).toBeGreaterThanOrEqual(15);
        for (const disposable of harness.disposables) disposable.dispose();
    });

    it("restores the stored mode without reshaping or reorienting", async () => {
        const harness = makeContext({ [EDITOR_LAYOUT_MODE_KEY]: "max-max" });
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

    it("skips the restore when the setting is off", async () => {
        state.config.restoreOnActivate = false;
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);

        await vi.advanceTimersByTimeAsync(100);
        expect(setLayoutCalls()).toHaveLength(0);
    });

    it("persists the mode a command selects", async () => {
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.maxBoth)!();
        expect(harness.store[EDITOR_LAYOUT_MODE_KEY]).toBe("max-max");

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.toggleVertical)!();
        expect(harness.store[EDITOR_LAYOUT_MODE_KEY]).toBe("max-even");

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.toggleHorizontal)!();
        expect(harness.store[EDITOR_LAYOUT_MODE_KEY]).toBe("even-even");

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.cycle)!();
        expect(harness.store[EDITOR_LAYOUT_MODE_KEY]).toBe("max-even");

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.maxVertical)!();
        expect(harness.store[EDITOR_LAYOUT_MODE_KEY]).toBe("even-max");
    });

    it("transposes without persisting a mode change", async () => {
        state.config.restoreOnActivate = false;
        const harness = makeContext({ [EDITOR_LAYOUT_MODE_KEY]: "max-even" });
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.transpose)!();

        const applied = setLayoutCalls().at(-1)!.arg as {
            orientation: number;
        };
        expect(applied.orientation).toBe(1);
        expect(harness.store[EDITOR_LAYOUT_MODE_KEY]).toBe("max-even");
    });

    it("re-applies on focus change when either direction is max", async () => {
        state.config.restoreOnActivate = false;
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.maxHorizontal)!();
        const before = setLayoutCalls().length;

        state.tabs.active = { viewColumn: 4 };
        for (const listener of state.listeners) listener();
        await vi.advanceTimersByTimeAsync(200);

        expect(setLayoutCalls().length).toBeGreaterThan(before);
    });

    it("leaves even-even alone when the grid emits events", async () => {
        state.config.restoreOnActivate = false;
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.even)!();
        const before = setLayoutCalls().length;

        state.tabs.active = { viewColumn: 4 };
        for (const listener of state.listeners) listener();
        await vi.advanceTimersByTimeAsync(200);

        expect(setLayoutCalls().length).toBe(before);
    });

    it("does not follow focus when the setting is off", async () => {
        state.config.restoreOnActivate = false;
        state.config.followActiveGroup = false;
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);

        await state.commands.get(EDITOR_LAYOUT_COMMANDS.maxHorizontal)!();
        const before = setLayoutCalls().length;

        state.tabs.active = { viewColumn: 4 };
        for (const listener of state.listeners) listener();
        await vi.advanceTimersByTimeAsync(200);

        expect(setLayoutCalls().length).toBe(before);
    });

    it("hides the status bar and writes nothing without editor groups", async () => {
        state.tabs.all = [];
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);

        expect(setLayoutCalls()).toHaveLength(0);
        expect(state.statusItem.hidden).toBeGreaterThan(0);
    });

    it("survives a failing getEditorLayout without writing a layout", async () => {
        state.layout = { bogus: true };
        const harness = makeContext();
        await editorLayoutPlugin.activate(harness.ctx as never);
        await vi.advanceTimersByTimeAsync(100);

        expect(setLayoutCalls()).toHaveLength(0);
    });
});
