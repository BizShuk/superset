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
import { projectsTodoPlugin } from "./projectsTodo/plugin";
import {
    globalCommandsPlugin,
    setDiagnosticChannel,
    setPluginManager,
} from "./globalCommandsPlugin";

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
export function activate(
    context: vscode.ExtensionContext
): Promise<{ extendMarkdownIt(md: MarkdownIt): MarkdownIt } | undefined> {
    console.log("[superset] activated");

    // Diagnostic channel — owned by the root so it survives across plugins.
    const diag = vscode.window.createOutputChannel("Superset");
    const log = (msg: string) => {
        const stamped = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
        console.log(`[superset] ${msg}`);
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

    // Plugin activation order is significant. `treePreview` and
    // `todoPreview` contribute markdown-it hooks; the manager
    // composes them in this order. Feature plugins follow so their
    // disposable registrations land in a predictable slot. The
    // `globalCommands` plugin is last so its commands can reach
    // already-registered feature state.
    const plugins: ExtensionPlugin[] = [
        treePreviewPlugin,
        todoPreviewPlugin,
        terminalsPlugin,
        mdnsPlugin,
        topologyPlugin,
        todoPlugin,
        projectsTodoPlugin,
        globalCommandsPlugin,
    ];

    // Await the full activation batch so every plugin has finished
    // its `activate()` before we compose the markdown-it chain.
    // VSCode accepts a `Thenable` return from `activate()`.
    return manager
        .activateAll(plugins, context)
        .then(() => manager.getMarkdownExtension());
}

export function deactivate(): void {
    // Plugin disposables are torn down by VSCode via
    // `context.subscriptions`; the manager also force-disposes any
    // plugin-registered disposables during its own `deactivateAll`
    // pass, but that's optional for the standard deactivation path.
}
