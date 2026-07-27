/**
 * Wrap one shell argument in single quotes, escaping embedded single quotes.
 *
 * This is the only boundary used when Superset has to send argv-shaped data
 * through `Terminal.sendText()`, which accepts a shell command string rather
 * than an argv array.
 */
export function quoteShellArg(value: string): string {
    if (value === "") return "''";
    return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Join a fixed command name and argv-shaped data into one shell-safe line. */
export function joinShellCommand(
    command: string,
    args: readonly string[]
): string {
    return [command, ...args.map(quoteShellArg)].join(" ");
}
