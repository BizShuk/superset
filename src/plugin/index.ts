// Plugin system barrel. Re-exports the public surface so callers
// (composition root, plugin adapters, tests) only need a single
// import path: `import { PluginManager, type ExtensionPlugin } from "./plugin"`.

export type {
    ExtensionPlugin,
    PluginContext,
    MarkdownIt,
    FenceRule,
} from "./types";
export { PluginManager } from "./manager";
export { createPluginContext, type BaseContext } from "./context";
export { createFeatureContext, type CreateFeatureContextOptions } from "./featureContext";
export {
    legacyPlugin,
    legacyPluginWithStatusBar,
    type LegacyPluginOptions,
    type LegacyPluginWithStatusBarOptions,
} from "./legacyAdapter";
