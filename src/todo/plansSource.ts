// plansSource — pure Markdown <-> PlanInfo transforms for the
// `plans/` folder under a workspace root.
//
// Deliberately parallels `parser.ts`: no I/O code lives here for
// tests to mock against; the scan is one `readdir` + one stat + an
// optional 8-line head read per entry. Cache / wiring lives in
// `TodoStore` / `ProjectsTodoStore`.

import { readdir, readFile, stat } from "fs/promises";
import * as path from "path";
import type { TodoItem } from "./types";

export interface PlanInfo {
    readonly basename: string;
    readonly title: string;
    readonly filePath: string;
    readonly mtimeMs: number;
}

export const PLANS_DIR_NAME = "plans";

/**
 * Synthetic line numbers used by plan items. Negative numbers are
 * reserved for virtual nodes (see `parser.ts` which uses `-1` for the
 * "Default" section); we use `-10` / `-11` to keep clear of any
 * other virtual line the parser might introduce later.
 */
export const PLANS_SECTION_LINE = -10;
export const PLAN_ITEM_LINE = -11;

const H1_RE = /^#\s+(.+?)\s*$/;
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}-/;
const HEAD_SCAN_LINES = 8;

/**
 * Read `<workspaceRoot>/plans/*.md` and return parsed metadata,
 * sorted by basename. Date-prefixed files (`2026-07-08-...`) sort
 * first because digits come before letters in `localeCompare`.
 *
 * Returns an empty array if the `plans/` directory does not exist
 * or is unreadable — callers map that to "no plans section" rather
 * than throwing.
 */
export async function scanPlans(workspaceRoot: string): Promise<PlanInfo[]> {
    const dir = path.join(workspaceRoot, PLANS_DIR_NAME);
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        return [];
    }

    const plans: PlanInfo[] = [];
    for (const basename of entries) {
        if (!basename.toLowerCase().endsWith(".md")) continue;
        const filePath = path.join(dir, basename);
        try {
            const s = await stat(filePath);
            if (!s.isFile()) continue;
            const title = await extractTitle(filePath, basename);
            plans.push({ basename, title, filePath, mtimeMs: s.mtimeMs });
        } catch {
            // Ignore unreadable files — partial scan is fine.
        }
    }
    plans.sort((a, b) => a.basename.localeCompare(b.basename));
    return plans;
}

/**
 * Read the first `# Heading` from a plan file, scanning only the
 * first {@link HEAD_SCAN_LINES} lines to bound the cost. Falls back
 * to a humanised basename when no H1 exists (empty file, code
 * fences, malformed input, ...).
 */
export async function extractTitle(filePath: string, basename: string): Promise<string> {
    try {
        const raw = await readFile(filePath, "utf-8");
        const head = raw.split("\n", HEAD_SCAN_LINES);
        for (const line of head) {
            const m = line.match(H1_RE);
            if (m) return m[1]!.trim();
        }
    } catch {
        // Fall through to basename fallback.
    }
    return basenameFallback(basename);
}

/**
 * Convert a basename like `2026-07-08-chore-foo.md` into a human-
 * readable title: strip the `YYYY-MM-DD-` prefix, drop `.md`, turn
 * dashes into spaces, title-case each word.
 */
export function basenameFallback(basename: string): string {
    return basename
        .replace(/\.md$/i, "")
        .replace(DATE_PREFIX_RE, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Pure converter: `PlanInfo` -> `TodoItem`. Exported so both
 * `TodoStore` and `ProjectsTodoStore` can build identical items
 * from the same source.
 *
 * `filePath` is set so the tree provider's menu-based open command
 * can resolve the absolute path; `parentSection` is set to the
 * synthetic "Plans" section label so future filter helpers can
 * branch on it if they ever need to.
 */
export function planInfoToTodoItem(info: PlanInfo): TodoItem {
    return {
        line: PLAN_ITEM_LINE,
        text: info.basename.replace(/\.md$/i, ""),
        description: info.title,
        kind: "plan",
        checked: false,
        children: [],
        filePath: info.filePath,
        parentSection: "Plans",
    };
}

/**
 * Build the synthetic `## Plans` section that the tree providers
 * append at the end of their top-level children. `level: undefined`
 * follows the same convention as the parser's "Default" section so
 * downstream renderers (`computeSectionContextValue`, etc.) treat
 * it as a virtual group with no real heading line.
 *
 * Plan items never have nested children, so the section node's
 * only structural role is to group its `items` under a named
 * heading. Returns a `TodoItem`; callers in the projectsTodo tree
 * provider cast this to `ProjectTodoItem` after spreading the
 * required `projectName` / `projectPath` fields (those fields are
 * added on the section node itself, not on the children).
 */
export function makePlansSection(items: TodoItem[]): TodoItem {
    return {
        line: PLANS_SECTION_LINE,
        text: "Plans",
        kind: "section",
        level: undefined,
        checked: false,
        children: items,
        description: "Design documents under ./plans/",
    };
}