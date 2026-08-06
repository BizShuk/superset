/** Stable metric keys shared by feature providers and diagnostics UI. */
export const DIAGNOSTIC_METRIC = {
    terminalCount: "terminalCount",
    unseenTerminalCount: "unseenTerminalCount",
    mDNSServiceCount: "mDNSServiceCount",
    todoItemCount: "todoItemCount",
} as const;

export type DiagnosticMetricName =
    (typeof DIAGNOSTIC_METRIC)[keyof typeof DIAGNOSTIC_METRIC];
