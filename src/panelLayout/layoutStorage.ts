// panelLayout/layoutStorage — pure storage helpers for the
// panel-layout-persistence feature. Reads and writes the most-recently
// active `viewId` through a `vscode.Memento` (workspaceState), with a
// strict whitelist of acceptable view IDs so junk written by older
// versions or external tools can't pollute restoration.
//
// No `vscode` imports — the module is unit-testable in plain Node and
// only depends on the structural shape `{ get(key), update(key, value) }`
// that both `Memento` and a fake satisfy.

/** Stable id used as the workspaceState key for the active-view record. */
export const ACTIVE_VIEW_KEY = "superset.activeViewId";

/**
 * Whitelist of TreeView IDs that participate in the panel layout.
 * Mirrors the registered `views` entries in `package.json`:
 *  - `superset`: terminals / mdns / topology / todo
 *  - `superset-overall`: workspaceTodo / projectsTodo
 *
 * Anything outside this set is treated as stale (e.g. a view that was
 * renamed or removed) and silently discarded by `sanitizeViewId`.
 */
export const TRACKED_VIEW_IDS: readonly string[] = [
    "superset.terminals",
    "superset.mdns",
    "superset.topology",
    "superset.todo",
    "superset.workspaceTodo",
    "superset.projectsTodo",
];

const trackedViewIdSet = new Set<string>(TRACKED_VIEW_IDS);

/**
 * Coerce an arbitrary stored value into a valid tracked viewId.
 * Returns `undefined` when the input is missing, not a string, or
 * not in the whitelist — callers should treat `undefined` as
 * "no last-active record" and skip restoration.
 */
export function sanitizeViewId(raw: unknown): string | undefined {
    if (typeof raw !== "string") return undefined;
    return trackedViewIdSet.has(raw) ? raw : undefined;
}

/** Read the persisted last-active viewId from a Memento-shaped state. */
export function readActiveViewId(
    state: { get<T>(key: string): T | undefined }
): string | undefined {
    return sanitizeViewId(state.get(ACTIVE_VIEW_KEY));
}

/**
 * Persist the supplied `viewId`, after sanitising it. Returns `true`
 * when the value was written, `false` when the input was rejected
 * (caller can log a warning). An explicit `undefined` always writes
 * through and clears any stale record.
 */
export async function writeActiveViewId(
    state: { update(key: string, value: unknown): Thenable<void> },
    viewId: string | undefined
): Promise<boolean> {
    const sanitized = viewId === undefined ? undefined : sanitizeViewId(viewId);
    if (viewId !== undefined && sanitized === undefined) {
        return false;
    }
    await state.update(ACTIVE_VIEW_KEY, sanitized);
    return true;
}
