// editorLayout/modeStorage — persistence for the chosen layout mode.
//
// Only the MODE is stored. The grid shape is deliberately NOT persisted:
// it is read back from `vscode.getEditorLayout` on every apply, so a
// grid the user reshaped by hand is observed rather than overwritten.
//
// No `vscode` import — the module only needs the structural shape
// `{ get(key), update(key, value) }` that both `Memento` and a test
// fake satisfy. Mirrors `panelLayout/layoutStorage.ts`.

import { parseMode, type EditorLayoutMode } from "./layoutModes";

/** workspaceState key holding the last chosen mode. */
export const EDITOR_LAYOUT_MODE_KEY = "superset.editorLayoutMode";

/** Read the persisted mode, or `undefined` when absent/invalid. */
export function readLayoutMode(
    state: { get<T>(key: string): T | undefined }
): EditorLayoutMode | undefined {
    return parseMode(state.get(EDITOR_LAYOUT_MODE_KEY));
}

/**
 * Persist `mode` after sanitising it. Returns `false` without writing
 * when the input is not one of the four modes; an explicit `undefined`
 * always writes through and clears the record.
 */
export async function writeLayoutMode(
    state: { update(key: string, value: unknown): Thenable<void> },
    mode: EditorLayoutMode | undefined
): Promise<boolean> {
    const sanitized = mode === undefined ? undefined : parseMode(mode);
    if (mode !== undefined && sanitized === undefined) return false;
    await state.update(EDITOR_LAYOUT_MODE_KEY, sanitized);
    return true;
}
