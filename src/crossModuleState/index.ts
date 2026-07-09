// Module-level mutable state shared across feature boundaries.
//
// This directory consolidates three setters that were previously scattered
// across `globalCommandsPlugin.ts` and `terminals/terminalSpawner.ts`.
// Each feature still publishes/consumes these via plain function calls —
// the only change is the import path. The long-term plan is to replace
// each setter pair with a proper `PluginContext` accessor (see
// `2026-07-08-chore-consistency-redundancy-scalability.md` §Stage 6).

export {
    setDiagnosticChannel,
    getDiagnosticChannel,
} from "./diagnosticChannel";
export { setPluginManager, getPluginManager } from "./pluginManager";
export {
    setTerminalSpawner,
    getTerminalSpawner,
    type TerminalSpawner,
} from "./terminalSpawner";