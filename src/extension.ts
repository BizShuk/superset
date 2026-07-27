import * as vscode from "vscode";
import {
    type ExtensionPlugin,
    PluginManager,
    type MarkdownIt,
} from "./plugin";
import { treePreviewPlugin } from "./treePreview/plugin";
import { todoPreviewPlugin } from "./todoPreview/plugin";
import { terminalsPlugin } from "./terminals/plugin";
import { mdnsPlugin } from "./mdns/plugin";
import { topologyPlugin } from "./topology/plugin";
import { todoPlugin } from "./todo/plugin";
import { sessionsPlugin } from "./sessions/plugin";
import { projectsTodoPlugin } from "./projectsTodo/plugin";
import { gitPlugin } from "./git/plugin";
import { editorLayoutPlugin } from "./editorLayout/plugin";
import { globalCommandsPlugin } from "./globalCommandsPlugin";
import { panelLayoutPlugin } from "./panelLayout/plugin";
import {
    setDiagnosticChannel,
    setPluginManager,
    setTerminalSpawner,
} from "./crossModuleState";
import {
    setTreeViewRegistry,
    TreeViewRegistry,
} from "./plugin/treeViewRegistry";

interface ActiveRuntime {
    readonly manager: PluginManager;
    readonly diag: vscode.OutputChannel;
    readonly log: (message: string) => void;
    readonly activation: Promise<void>;
}

let activeRuntime: ActiveRuntime | undefined;
let teardownPromise: Promise<void> | undefined;

/**
 * Composition root — pre-plugin-orchestration this file directly
 * imported every feature and stitched the markdown preview together.
 * After Stage 6 it is a *declarative* list: each feature is an
 * `ExtensionPlugin`, the `PluginManager` owns lifecycle, error
 * isolation, disposable collection, and reset-handler fan-out.
 *
 * Adding a new feature no longer requires editing this file — drop
 * the plugin into the list (or load it dynamically).
 */
export async function activate(
    context: vscode.ExtensionContext
): Promise<{ extendMarkdownIt(md: MarkdownIt): MarkdownIt } | undefined> {
    // VS Code activates an extension once per host, but keeping this boundary
    // re-entrant prevents a reload/test activation from inheriting sockets,
    // watchers, commands, or timers from a previous runtime.
    if (teardownPromise) {
        await teardownPromise;
    }
    if (activeRuntime) {
        await deactivate();
    }

    // Diagnostic channel — owned by the root so it survives across plugins.
    const diag = vscode.window.createOutputChannel("Superset");
    const log = (msg: string) => {
        const stamped = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
        diag.appendLine(stamped);
    };
    log(`activate session=${vscode.env.sessionId.slice(0, 8)}`);

    const workspaceFolder =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    const manager = new PluginManager({
        extensionContext: context,
        workspaceFolder,
        log,
        // statusBar is kept alive by the features that need it (e.g.
        // terminal highlight presenter). Plugins don't read it
        // directly via PluginContext yet — they push commands through
        // their own shims.
        showStatus: () => {},
    });

    // Wire the diagnostic channel + manager into the global-commands
    // shim so `superset.showLogs` and `superset.resetCaches` can
    // reach them. Set BEFORE the manager activates any plugin so
    // the global commands plugin's `activate()` can see them if it
    // looks up the manager eagerly.
    setDiagnosticChannel(diag);
    setPluginManager(manager);
    // The shared TreeViewRegistry backs the cross-panel
    // `superset.revealInTree` command. Set BEFORE any plugin
    // activates so the panel's `registerTreeView()` calls see the
    // global instance.
    setTreeViewRegistry(new TreeViewRegistry());

    // Plugin activation order is significant. `treePreview` and
    // `todoPreview` contribute markdown-it hooks; the manager
    // composes them in this order. Feature plugins follow so their
    // disposable registrations land in a predictable slot. The
    // `globalCommands` plugin comes next so its commands can reach
    // already-registered feature state. The `panelLayout` plugin is
    // LAST because it restores the last-active TreeView — every
    // other view plugin must have finished `createTreeView` so the
    // restore focus call (`${viewId}.focus`) lands on a live view.
    // A 50ms setTimeout inside `panelLayoutPlugin.activate` is a
    // belt-and-suspenders fallback if this ordering is ever changed.
    const plugins: ExtensionPlugin[] = [
        treePreviewPlugin,
        todoPreviewPlugin,
        terminalsPlugin,
        mdnsPlugin,
        topologyPlugin,
        sessionsPlugin,
        todoPlugin,
        projectsTodoPlugin,
        gitPlugin,
        editorLayoutPlugin,
        globalCommandsPlugin,
        panelLayoutPlugin,
    ];

    // Store the in-flight activation as part of the runtime. If shutdown
    // races activation, deactivate() waits for the batch before walking the
    // completed plugin set in reverse order.
    const activation = manager.activateAll(plugins, context);
    const runtime: ActiveRuntime = { manager, diag, log, activation };
    activeRuntime = runtime;

    try {
        await activation;
    } catch (err) {
        if (activeRuntime === runtime) {
            await deactivate();
        }
        throw err;
    }

    // A concurrent deactivate/re-activate may have retired this runtime while
    // activation was settling. Never return hooks backed by a dead manager.
    if (activeRuntime !== runtime) {
        return undefined;
    }
    return manager.getMarkdownExtension();
}

export function deactivate(): Promise<void> {
    if (teardownPromise) {
        return teardownPromise;
    }

    const runtime = activeRuntime;
    if (!runtime) {
        return Promise.resolve();
    }
    activeRuntime = undefined;

    teardownPromise = (async () => {
        try {
            // `PluginContext.registerDisposable()` writes to manager-owned
            // pools, not `ExtensionContext.subscriptions`. This call is the
            // authoritative shutdown path for mDNS, TreeView refresh timers,
            // file watchers, PTYs, commands, and status items.
            await runtime.activation.catch(() => undefined);
            runtime.log("deactivate start");
            await runtime.manager.deactivateAll();
            runtime.log("deactivate complete");
        } finally {
            // Drop module-level roots after feature teardown so no stale
            // manager/view/provider/PTY factory can survive a window reload.
            setTerminalSpawner(undefined);
            setTreeViewRegistry(undefined);
            setPluginManager(undefined);
            setDiagnosticChannel(undefined);
            runtime.diag.dispose();
        }
    })().finally(() => {
        teardownPromise = undefined;
    });

    return teardownPromise;
}
