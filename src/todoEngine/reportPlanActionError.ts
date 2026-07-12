// Map a `PlanActionError` to a contextual user-visible message.
//
// Both `todo` and `projectsTodo` panels surface the same four plan
// transitions (complete / backlog / archive / delete) and need the
// same error mapping. Centralising it here keeps the user-facing
// strings consistent and lets the factory emit the message without
// each panel re-implementing the switch.

import * as vscode from "vscode";
import type { PlanActionKind } from "./types";
import { PlanActionError } from "../todo/planActions";

export function reportPlanActionError(
    action: PlanActionKind,
    basename: string,
    err: unknown,
): void {
    const verb = action === "delete" ? "delete" : `move (${action})`;
    if (err instanceof PlanActionError) {
        if (err.code === "exists") {
            vscode.window.showErrorMessage(
                `Cannot ${verb} "${basename}": a file already exists at the destination. Resolve manually and retry.`,
            );
            return;
        }
        if (err.code === "missing") {
            vscode.window.showErrorMessage(
                `Cannot ${verb} "${basename}": source plan no longer exists (was it moved already?).`,
            );
            return;
        }
        vscode.window.showErrorMessage(
            `Failed to ${verb} "${basename}": ${err.message}`,
        );
        return;
    }
    vscode.window.showErrorMessage(
        `Failed to ${action} plan "${basename}": ${err}`,
    );
}
