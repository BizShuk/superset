// Plugin system barrel. Re-exports the public surface so callers
// (composition root, plugin declarations, tests) only need a single
// import path: `import { PluginManager, type ExtensionPlugin } from "./plugin"`.

export type {
    ExtensionPlugin,
    PluginContext,
    RuntimeDiagnostics,
    RuntimeDiagnosticsProvider,
    MarkdownIt,
    FenceRule,
} from "./types";
export { PluginManager } from "./manager";
export {
    createPluginContext,
    type BaseContext,
    type PluginContextBindings,
} from "./context";
export { TreeViewRegistry } from "./treeViewRegistry";
