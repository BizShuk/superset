// Label-rendering helpers shared by `todoTreeProvider` and
// `projectsTodoTreeProvider`. Both providers repeat the same chain
// when rendering checkbox / list rows:
//   1. strip `[P0]` / `[P1]` / `[P2]` tag → derive priority
//   2. detect a `[text](url)` link to choose contextValue
//   3. strip the link syntax from the displayed label
// This module owns each step so the providers can call them in
// sequence without duplicating the regexes.

import * as vscode from "vscode";
import { cleanLabelText, extractLink } from "./linkUtils";

export type PriorityTag = "P0" | "P1" | "P2" | null;

const PRIORITY_REGEX = /^(\[|\()?(P[0-2])(\]|\))?[\s-:]*/i;

/**
 * Strip a leading priority tag and return both the cleaned label and
 * the matched priority (or null if none). The tag is recognised in
 * any of these shapes:
 *   [P0] / [P1] / [P2]   (square brackets)
 *   (P0) / (P1) / (P2)   (parens)
 *   P0: / P1- / P2 …     (bare, followed by punctuation/whitespace)
 */
export function extractPriorityTag(rawText: string): {
    text: string;
    priority: PriorityTag;
} {
    const match = rawText.match(PRIORITY_REGEX);
    if (!match) return { text: rawText, priority: null };
    const priority = (match[2]?.toUpperCase() ?? null) as PriorityTag;
    const text = rawText.substring(match[0].length).trim();
    return { text, priority };
}

/**
 * Detect whether the label carries a Markdown link (`[text](url)`)
 * and return the cleaned display label. The link syntax is stripped
 * from the label so the TreeView shows only the human-readable text.
 */
export function stripMarkdownLink(rawText: string): {
    text: string;
    hasLink: boolean;
} {
    const link = extractLink(rawText);
    if (!link) return { text: rawText, hasLink: false };
    return { text: cleanLabelText(rawText), hasLink: true };
}

/**
 * Resolve the priority-tag SVG iconPath under the extension's
 * `pkg/resources/` folder. Returns undefined when no priority is set or
 * when `extensionUri` is unavailable, so callers can fall back to a
 * ThemeIcon.
 */
export function priorityIconPath(
    extensionUri: vscode.Uri | undefined,
    priority: PriorityTag,
): vscode.Uri | undefined {
    if (!priority || !extensionUri) return undefined;
    return vscode.Uri.joinPath(
        extensionUri,
        "pkg",
        "resources",
        `${priority.toLowerCase()}.svg`,
    );
}