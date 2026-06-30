import { matchesTerminal } from "./treeFilter";

export interface JumpableTerminal {
    readonly name: string;
    readonly pid?: number;
    readonly cwd?: string;
    show(): void;
}

export interface QuickPickItem {
    readonly label: string;
    readonly description?: string;
    readonly terminal: JumpableTerminal;
}

export function scoreMatch(query: string, term: JumpableTerminal): number {
    const q = query.toLowerCase();
    const n = term.name.toLowerCase();
    if (n === q) return 100;
    if (n.startsWith(q)) return 80;
    if (n.includes(q)) return 50;
    if (term.pid != null && String(term.pid).startsWith(q)) return 70;
    if (matchesTerminal(query, term, term.cwd)) return 30;
    return 0;
}

export function buildQuickPickItems(
    terminals: readonly JumpableTerminal[],
    query: string
): QuickPickItem[] {
    if (!query) {
        return terminals.map((t) => ({
            label: t.name,
            description: t.pid ? `pid ${t.pid}` : undefined,
            terminal: t,
        }));
    }
    return terminals
        .map((t) => ({ t, s: scoreMatch(query, t) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map(({ t }) => ({
            label: t.name,
            description: t.pid ? `pid ${t.pid}` : undefined,
            terminal: t,
        }));
}
