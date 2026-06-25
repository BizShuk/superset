/**
 * Pure computed title for the TODO panel, reflecting the current
 * show/hide-completed filter state.
 *
 * `titlePrefix` is the base panel title (e.g. "TODO").
 * `isFiltering` is true when "hide completed" is active.
 * `hiddenCount` is the number of top-level items hidden by the filter.
 *
 * Returns the next tree view title string — no vscode dependency.
 */
export function computeTodoBadgeTitle(
    titlePrefix: string,
    isFiltering: boolean,
    hiddenCount: number
): string {
    if (!isFiltering || hiddenCount <= 0) {
        return titlePrefix;
    }
    return `${titlePrefix}  (已隱藏 ${hiddenCount} 個已完成)`;
}
