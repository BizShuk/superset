// planActions — pure file-system operations on a workspace's
// `plans/` folder, parameterised by the workspace root.
//
// Each action is one fs.promises call (rename for move, unlink for
// delete). Target directories are created on demand so callers
// don't have to know the standard layout. The standard lifecycle
// transitions are encoded in the public function names:
//
//   plans/<f>  →  docs/specs/<f>   completePlan()   "implementation done"
//   plans/<f>  →  docs/backlog/<f> backlogPlan()    "parked for later"
//   plans/<f>  →  plans/archive/<f> archivePlan()   "historical record only"
//   plans/<f>  →  (gone)           deletePlan()     "no historical value"
//
// No `vscode` import — pure fs/promises + path, unit-testable in
// vitest without mocking. Errors are surfaced via `PlanActionError`
// with a `code` discriminator so callers can show contextual
// messages (e.g. "plan not found" vs. generic I/O error).

import { mkdir, rename, stat, unlink } from "fs/promises";
import * as path from "path";

const PLANS_DIR = "plans";
const SPECS_DIR = path.join("docs", "specs");
const BACKLOG_DIR = path.join("docs", "backlog");
const ARCHIVE_DIR = path.join("plans", "archive");

/** Why a plan action failed. Callers can branch on this for messages. */
export type PlanActionErrorCode = "missing" | "exists" | "io";

export class PlanActionError extends Error {
    public readonly code: PlanActionErrorCode;
    constructor(message: string, code: PlanActionErrorCode) {
        super(message);
        this.name = "PlanActionError";
        this.code = code;
    }
}

async function ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
}

async function targetExists(target: string): Promise<boolean> {
    try {
        await stat(target);
        return true;
    } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e?.code === "ENOENT") return false;
        throw err;
    }
}

async function movePlan(
    workspaceRoot: string,
    basename: string,
    targetDir: string,
): Promise<void> {
    const src = path.join(workspaceRoot, PLANS_DIR, basename);
    const dst = path.join(workspaceRoot, targetDir, basename);

    // Refuse to clobber an existing file in the target — the user
    // should resolve the conflict manually (rename / merge / delete)
    // rather than silently overwrite an unrelated spec/archived plan.
    if (await targetExists(dst)) {
        throw new PlanActionError(
            `Target already exists: ${dst}`,
            "exists",
        );
    }

    try {
        await rename(src, dst);
    } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e?.code === "ENOENT") {
            throw new PlanActionError(
                `Source plan not found: ${src}`,
                "missing",
            );
        }
        throw new PlanActionError(
            `Failed to move plan: ${e?.message ?? err}`,
            "io",
        );
    }
}

/**
 * Move a plan from `plans/<basename>` to `docs/specs/<basename>`.
 * Implements the "implementation complete" transition documented
 * in the root `~/projects/CLAUDE.md` lifecycle diagram.
 */
export async function completePlan(
    workspaceRoot: string,
    basename: string,
): Promise<void> {
    await ensureDir(path.join(workspaceRoot, SPECS_DIR));
    await movePlan(workspaceRoot, basename, SPECS_DIR);
}

/**
 * Move a plan from `plans/<basename>` to `docs/backlog/<basename>`.
 * Use this when the plan is parked for later — it's a "still live,
 * just not now" state, distinct from archive (no longer relevant)
 * and complete (done).
 */
export async function backlogPlan(
    workspaceRoot: string,
    basename: string,
): Promise<void> {
    await ensureDir(path.join(workspaceRoot, BACKLOG_DIR));
    await movePlan(workspaceRoot, basename, BACKLOG_DIR);
}

/**
 * Move a plan from `plans/<basename>` to `plans/archive/<basename>`.
 * Use this for old/abandoned plans that should be preserved as
 * historical record but no longer appear in the live overview.
 */
export async function archivePlan(
    workspaceRoot: string,
    basename: string,
): Promise<void> {
    await ensureDir(path.join(workspaceRoot, ARCHIVE_DIR));
    await movePlan(workspaceRoot, basename, ARCHIVE_DIR);
}

/**
 * Delete a plan from `plans/<basename>`. Use this when the plan
 * was created in error and has no historical value. Prefer
 * `archivePlan` for anything that might be worth referencing
 * later — git history covers most cases, but explicit archive
 * makes intent visible.
 */
export async function deletePlan(
    workspaceRoot: string,
    basename: string,
): Promise<void> {
    const target = path.join(workspaceRoot, PLANS_DIR, basename);
    try {
        await unlink(target);
    } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e?.code === "ENOENT") {
            throw new PlanActionError(
                `Source plan not found: ${target}`,
                "missing",
            );
        }
        throw new PlanActionError(
            `Failed to delete plan: ${e?.message ?? err}`,
            "io",
        );
    }
}
