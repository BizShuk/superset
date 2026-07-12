// Four-way contextValue dispatch for checkbox / list rows.
//
// Both `todoTreeProvider` and `projectsTodoTreeProvider` pick a
// `viewItem` string based on two boolean axes:
//   - isArchived:    is this row in `## Archive` or marked archived?
//   - hasLink:       does the label carry a `[text](url)` Markdown link?
//
// The four combinations need four distinct context values so
// `package.json` menu `when` clauses can target each variant. The
// provider passes the prefix (`"todo"` or `"projectsTodo"`) plus the
// two axes; this helper returns the matching string.

export type ContextValueAxis = "checkbox" | "list";

export interface DispatchContextValueInput {
    /** `"todo"` or `"projectsTodo"` — the panel's command prefix. */
    prefix: "todo" | "projectsTodo";
    /** The row kind (without archive suffix). */
    kind: ContextValueAxis;
    /** True if the row sits under an archive section or has an
     *  archive tag in its label. */
    isArchived: boolean;
    /** True if the row's label carries a Markdown link. */
    hasLink: boolean;
}

export function dispatchContextValue(
    input: DispatchContextValueInput,
): string {
    const { prefix, kind, isArchived, hasLink } = input;
    // The first letter of `kind` is capitalised so the result
    // matches the existing contextValue strings (e.g.
    // "todoCheckboxWithLink", not "todocheckboxWithLink") — package.json
    // menu `when` clauses are case-sensitive.
    const kindCapitalised = kind.charAt(0).toUpperCase() + kind.slice(1);
    const archiveSuffix = isArchived ? "Archived" : "";
    const linkSuffix = hasLink ? "WithLink" : "";
    return `${prefix}${kindCapitalised}${linkSuffix}${archiveSuffix}`;
}