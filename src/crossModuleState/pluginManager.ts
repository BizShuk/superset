// PluginManager reference — published by `extension.ts` after the
// manager is constructed, so `superset.resetCaches` can call
// `manager.resetAll()` and fan out to every plugin's reset handlers.
// See `2026-07-08-chore-consistency-redundancy-scalability.md` §Stage 6
// for the long-term DI migration that will replace this setter with a
// proper PluginContext accessor.

import type { PluginManager } from "../plugin";

let managerRef: PluginManager | undefined;

/** Set the active PluginManager. Called once by `extension.ts` after
 *  construction. Passing `undefined` clears it (used during teardown). */
export function setPluginManager(mgr: PluginManager | undefined): void {
    managerRef = mgr;
}

/** Return the currently-registered manager, or `undefined` if the
 *  extension has not activated yet. */
export function getPluginManager(): PluginManager | undefined {
    return managerRef;
}