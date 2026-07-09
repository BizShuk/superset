// panelLayout/restoreView — pure restore helper. Given a viewId and a
// focus function (typically `vscode.commands.executeCommand`), try to
// surface the corresponding TreeView. Wraps focus in a try/catch so a
// hidden or renamed view fails silently instead of crashing the
// activation (see `plans/2026-07-05-architecture-panel-layout-
// persistence.md` §7 risk-2).
//
// The focus function is injectable so the file stays free of `vscode`
// imports and unit-testable in plain Node — the production caller
// passes `executeCommand(viewId.focus)` and the test passes a stub.

export interface RestoreTarget {
    /** Focus call. Resolves on success, throws on unknown / hidden view. */
    readonly focus: () => Thenable<unknown>;
}

/**
 * Restore the named view by calling `target.focus()`. Returns `true`
 * when the call succeeded, `false` when it threw or no viewId was
 * supplied. NEVER rethrows — the caller (the plugin's `activate`) is
 * already past user-visible initialisation and any thrown error here
 * would silently no-op the entire extension activation chain.
 */
export async function tryRestore(
    viewId: string | undefined,
    targets: ReadonlyMap<string, RestoreTarget>,
    log: (msg: string) => void
): Promise<boolean> {
    if (!viewId) return false;
    const target = targets.get(viewId);
    if (!target) {
        log(`panelLayout: restore — no target for viewId=${viewId}`);
        return false;
    }
    try {
        await target.focus();
        log(`panelLayout: restored ${viewId}`);
        return true;
    } catch (err) {
        log(
            `panelLayout: restore ${viewId} failed: ${
                err instanceof Error ? err.message : String(err)
            }`
        );
        return false;
    }
}
