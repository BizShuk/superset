export interface FilterableTerminal {
    readonly name: string;
}

export function matchesTerminal(
    query: string,
    handle: FilterableTerminal,
    cwd: string | undefined
): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    if (handle.name.toLowerCase().includes(q)) return true;
    if (cwd && cwd.toLowerCase().includes(q)) return true;
    return false;
}
