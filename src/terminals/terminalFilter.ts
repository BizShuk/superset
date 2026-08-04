/**
 * Should this terminal ever appear in the dashboard panel?
 *
 * Some terminals are owned by other agents/extensions and exist only as
 * silent background workers — e.g. the `Antigravity Agent` terminal that
 * Antigravity spawns. They are not user-facing work surfaces and surfacing
 * them in the Terminals panel is noise. We exclude them entirely (never
 * added to the registry), so they get no row and no highlight.
 *
 * This runs at every entry point that can add a terminal to the registry:
 * the pre-population loop in `register()` and the `onDidOpenTerminal`
 * bridge in `lifecycle.ts`.
 *
 * Pure and unit-testable — no vscode dependency.
 */
export function shouldTrackTerminal(name: string): boolean {
    return !/antigravity/i.test(name);
}
