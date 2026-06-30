export interface KeyedState {
    keys(): readonly string[];
}

/**
 * Collects all keys from a KeyedState that start with "superset.".
 */
export function collectSupersetKeys(state: KeyedState): readonly string[] {
    return state.keys().filter((k) => k.startsWith("superset."));
}
