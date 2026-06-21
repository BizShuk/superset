/**
 * The subset of `vscode.Terminal.creationOptions` the auto-PTY layer
 * inspects. Kept as a structural shape (not the vscode types) so the
 * decision is a pure, unit-testable function with no vscode dependency.
 *
 * Fields map to `TerminalOptions` / `ExtensionTerminalOptions`:
 * - `location`  set when the terminal lives in the editor area or a split
 * - `shellPath` / `shellArgs`  a custom shell we could not reproduce
 * - `hideFromUser`  a hidden background terminal owned by another extension
 * - `pty`  present on ExtensionTerminalOptions (already a pseudoterminal)
 */
export interface InspectableCreationOptions {
    name?: string;
    location?: unknown;
    shellPath?: string;
    shellArgs?: string | string[];
    hideFromUser?: boolean;
    pty?: unknown;
}

export interface AutoReplaceDecision {
    replace: boolean;
    reason: string;
}

/**
 * Decide whether the auto-PTY layer should dispose a freshly-opened
 * terminal and replace it with a PTY-backed clone.
 *
 * Root-cause guard: auto-replace can only faithfully reproduce a *plain
 * panel terminal* (default shell, default location, visible, not already a
 * pseudoterminal). Any terminal carrying creation options we cannot copy —
 * editor/split location, custom shell, hidden, or an existing pty — is left
 * untouched and falls back to the shell-integration OutputWatcher for TUI
 * detection. Replacing those caused the editor-area-relocation and
 * agent-terminal-breakage bugs, so the conservative default is "do not
 * replace unless we are sure it is reproducible".
 */
export function decideAutoReplace(
    creationOptions: InspectableCreationOptions,
    name: string
): AutoReplaceDecision {
    if (/antigravity/i.test(name)) {
        return { replace: false, reason: "agent-owned (antigravity)" };
    }
    if (creationOptions.pty) {
        return { replace: false, reason: "already a pseudoterminal (pty)" };
    }
    if (creationOptions.shellPath || creationOptions.shellArgs) {
        return {
            replace: false,
            reason: "custom shell (shellPath/shellArgs)",
        };
    }
    if (creationOptions.hideFromUser) {
        return { replace: false, reason: "hidden background terminal" };
    }
    if (creationOptions.location !== undefined) {
        return {
            replace: false,
            reason: "non-panel location (editor area / split)",
        };
    }
    return { replace: true, reason: "plain panel terminal" };
}
