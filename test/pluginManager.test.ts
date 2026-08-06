import { describe, it, expect, vi } from "vitest";
import { PluginManager, type ExtensionPlugin, type PluginContext } from "../src/plugin";
import { TreeViewRegistry } from "../src/plugin/treeViewRegistry";
import type * as vscode from "vscode";

/** Minimal stand-in for `vscode.ExtensionContext` — only the members
 *  the manager actually touches. */
function fakeExtCtx(): vscode.ExtensionContext {
    const workspaceState = new Map<string, unknown>();
    return {
        extensionUri: { fsPath: "/fake" } as vscode.Uri,
        globalState: { get: () => undefined, update: async () => {} } as unknown as vscode.Memento,
        workspaceState: {
            get: (k: string) => workspaceState.get(k),
            update: async (k: string, v: unknown) => {
                if (v === undefined) workspaceState.delete(k);
                else workspaceState.set(k, v);
            },
        } as unknown as vscode.Memento,
    } as unknown as vscode.ExtensionContext;
}

function makePlugin(overrides: Partial<ExtensionPlugin> & { id: string }): ExtensionPlugin {
    return {
        name: overrides.id,
        activate: () => {},
        ...overrides,
    };
}

describe("PluginManager", () => {
    it("activates every plugin and tracks it by id", async () => {
        const log = vi.fn();
        const mgr = new PluginManager({
            extensionContext: fakeExtCtx(),
            workspaceFolder: "/ws",
            log,
            showLogs: () => {},
            createTerminal: () => ({}) as vscode.Terminal,
            treeViewRegistry: new TreeViewRegistry(),
        });

        const a = makePlugin({ id: "a", activate: vi.fn() });
        const b = makePlugin({ id: "b", activate: vi.fn() });

        await mgr.activateAll([a, b]);

        expect(a.activate).toHaveBeenCalledOnce();
        expect(b.activate).toHaveBeenCalledOnce();
        expect(mgr.has("a")).toBe(true);
        expect(mgr.has("b")).toBe(true);
        expect(log).toHaveBeenCalledWith("plugin activated: a");
        expect(log).toHaveBeenCalledWith("plugin activated: b");
    });

    it("isolates a failing plugin so siblings still activate", async () => {
        const log = vi.fn();
        const mgr = new PluginManager({
            extensionContext: fakeExtCtx(),
            workspaceFolder: "/ws",
            log,
            showLogs: () => {},
            createTerminal: () => ({}) as vscode.Terminal,
            treeViewRegistry: new TreeViewRegistry(),
        });

        const boom = makePlugin({
            id: "boom",
            activate: () => {
                throw new Error("kaboom");
            },
        });
        const ok = makePlugin({ id: "ok", activate: vi.fn() });

        await mgr.activateAll([boom, ok]);

        expect(mgr.has("boom")).toBe(false);
        expect(mgr.has("ok")).toBe(true);
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("plugin boom failed to activate")
        );
    });

    it("tears down partial resources when plugin activation fails", async () => {
        const log = vi.fn();
        const mgr = new PluginManager({
            extensionContext: fakeExtCtx(),
            workspaceFolder: "/ws",
            log,
            showLogs: () => {},
            createTerminal: () => ({}) as vscode.Terminal,
            treeViewRegistry: new TreeViewRegistry(),
        });
        const disposable = { dispose: vi.fn() };
        const deactivate = vi.fn();
        const broken = makePlugin({
            id: "partial",
            activate: (ctx: PluginContext) => {
                ctx.registerDisposable(disposable);
                throw new Error("failed after allocating");
            },
            deactivate,
        });

        await mgr.activateAll([broken]);

        expect(deactivate).toHaveBeenCalledOnce();
        expect(disposable.dispose).toHaveBeenCalledOnce();
        expect(mgr.has("partial")).toBe(false);
        expect(mgr.getDisposables("partial")).toEqual([]);
        await mgr.deactivateAll();
        expect(deactivate).toHaveBeenCalledOnce();
        expect(disposable.dispose).toHaveBeenCalledOnce();
    });

    it("does not persist transient activation failures", async () => {
        const ext = fakeExtCtx();
        const mgr = new PluginManager({
            extensionContext: ext,
            workspaceFolder: "/ws",
            log: () => {},
            showLogs: () => {},
            createTerminal: () => ({}) as vscode.Terminal,
            treeViewRegistry: new TreeViewRegistry(),
        });

        await mgr.activateAll(
            [makePlugin({ id: "broken", activate: () => { throw new Error("nope"); } })]
        );

        expect(ext.workspaceState.get("plugin.failed.broken")).toBeUndefined();
    });

    it("collects disposables and disposes them on deactivate", async () => {
        const ext = fakeExtCtx();
        const mgr = new PluginManager({
            extensionContext: ext,
            workspaceFolder: "/ws",
            log: () => {},
            showLogs: () => {},
            createTerminal: () => ({}) as vscode.Terminal,
            treeViewRegistry: new TreeViewRegistry(),
        });

        const d1 = { dispose: vi.fn() };
        const d2 = { dispose: vi.fn() };
        const plugin = makePlugin({
            id: "d",
            activate: (ctx: PluginContext) => {
                ctx.registerDisposable(d1);
                ctx.registerDisposable(d2);
            },
        });

        await mgr.activateAll([plugin]);
        expect(mgr.getDisposables("d")).toEqual([d1, d2]);

        await mgr.deactivateAll();
        expect(d1.dispose).toHaveBeenCalledOnce();
        expect(d2.dispose).toHaveBeenCalledOnce();
        expect(mgr.has("d")).toBe(false);

        await mgr.deactivateAll();
        expect(d1.dispose).toHaveBeenCalledOnce();
        expect(d2.dispose).toHaveBeenCalledOnce();
    });

    it("disposes plugin resources in reverse registration order", async () => {
        const mgr = new PluginManager({
            extensionContext: fakeExtCtx(),
            workspaceFolder: "/ws",
            log: () => {},
            showLogs: () => {},
            createTerminal: () => ({}) as vscode.Terminal,
            treeViewRegistry: new TreeViewRegistry(),
        });
        const order: string[] = [];
        const plugin = makePlugin({
            id: "ordered",
            activate: (ctx) => {
                ctx.registerDisposable({ dispose: () => order.push("first") });
                ctx.registerDisposable({ dispose: () => order.push("second") });
            },
        });

        await mgr.activateAll([plugin]);
        await mgr.deactivateAll();

        expect(order).toEqual(["second", "first"]);
    });

    it("runs reset handlers and isolates per-handler failures", async () => {
        const log = vi.fn();
        const mgr = new PluginManager({
            extensionContext: fakeExtCtx(),
            workspaceFolder: "/ws",
            log,
            showLogs: () => {},
            createTerminal: () => ({}) as vscode.Terminal,
            treeViewRegistry: new TreeViewRegistry(),
        });

        const h1 = vi.fn().mockRejectedValue(new Error("reset fail"));
        const h2 = vi.fn().mockResolvedValue(undefined);
        const plugin = makePlugin({
            id: "r",
            activate: (ctx: PluginContext) => {
                ctx.registerResetHandler(h1);
                ctx.registerResetHandler(h2);
            },
        });

        await mgr.activateAll([plugin]);
        await mgr.resetAll();

        expect(h1).toHaveBeenCalledOnce();
        expect(h2).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("reset handler from r threw")
        );
    });

    it("aggregates live diagnostics from active plugins", async () => {
        const mgr = new PluginManager({
            extensionContext: fakeExtCtx(),
            workspaceFolder: "/ws",
            log: () => {},
            showLogs: () => {},
            createTerminal: () => ({}) as vscode.Terminal,
            treeViewRegistry: new TreeViewRegistry(),
        });
        const plugin = makePlugin({
            id: "runtime",
            activate: (ctx: PluginContext) => {
                ctx.registerDiagnosticsProvider(() => ({
                    terminalCount: 3,
                    todoItemCount: 7,
                }));
            },
        });

        await mgr.activateAll([plugin]);

        const snapshot = mgr.getRuntimeDiagnostics();
        expect(snapshot).toEqual({
            activePluginIds: ["runtime"],
            metrics: { terminalCount: 3, todoItemCount: 7 },
        });
    });

    it("isolates a diagnostics provider failure from healthy providers", async () => {
        const log = vi.fn();
        const mgr = new PluginManager({
            extensionContext: fakeExtCtx(),
            workspaceFolder: "/ws",
            log,
            showLogs: () => {},
            createTerminal: () => ({}) as vscode.Terminal,
            treeViewRegistry: new TreeViewRegistry(),
        });
        const diagnosticPlugin = (
            id: string,
            provider: () => Readonly<Record<string, number>>
        ) =>
            makePlugin({
                id,
                activate: (ctx: PluginContext) => {
                    ctx.registerDiagnosticsProvider(provider);
                },
            });

        await mgr.activateAll(
            [
                diagnosticPlugin("broken", () => {
                    throw new Error("snapshot failed");
                }),
                diagnosticPlugin("healthy", () => ({ mDNSServiceCount: 4 })),
            ]
        );

        const snapshot = mgr.getRuntimeDiagnostics();
        expect(snapshot.metrics).toEqual({ mDNSServiceCount: 4 });
        expect(snapshot.activePluginIds).toEqual(["broken", "healthy"]);
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("diagnostics provider from broken threw")
        );
    });

    it("composes contributeMarkdownIt across plugins in order", async () => {
        const mgr = new PluginManager({
            extensionContext: fakeExtCtx(),
            workspaceFolder: "/ws",
            log: () => {},
            showLogs: () => {},
            createTerminal: () => ({}) as vscode.Terminal,
            treeViewRegistry: new TreeViewRegistry(),
        });

        const order: string[] = [];
        const p1: ExtensionPlugin = {
            id: "p1",
            name: "p1",
            activate: () => {},
            contributeMarkdownIt: (md) => {
                (md as unknown as { tag: string[] }).tag = ["p1"];
                order.push("p1");
                return md;
            },
        };
        const p2: ExtensionPlugin = {
            id: "p2",
            name: "p2",
            activate: () => {},
            contributeMarkdownIt: (md) => {
                order.push("p2");
                (md as unknown as { tag: string[] }).tag.push("p2");
                return md;
            },
        };

        await mgr.activateAll([p1, p2]);

        const ext = mgr.getMarkdownExtension();
        expect(ext).toBeDefined();
        const md: { tag: string[] } = { tag: [] };
        ext!.extendMarkdownIt(md as never);

        expect(order).toEqual(["p1", "p2"]);
        expect(md.tag).toEqual(["p1", "p2"]);
    });

    it("returns undefined from getMarkdownExtension when no plugin contributes", async () => {
        const mgr = new PluginManager({
            extensionContext: fakeExtCtx(),
            workspaceFolder: "/ws",
            log: () => {},
            showLogs: () => {},
            createTerminal: () => ({}) as vscode.Terminal,
            treeViewRegistry: new TreeViewRegistry(),
        });
        await mgr.activateAll([makePlugin({ id: "plain" })]);
        expect(mgr.getMarkdownExtension()).toBeUndefined();
    });
});
