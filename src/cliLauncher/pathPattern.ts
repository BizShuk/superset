// CLI Launcher Regex path rule 的 pure validation 與 matching。
//
// Regex 必須使用明確的 `{ regex, flags? }` object，避免把 Unix absolute path
// 誤判為 `/pattern/flags`。無效 source / flags 直接忽略，settings 錯字不得讓
// 整個 CLI View 失效。

/** settings 內 Regex rule 的 raw object shape。 */
export interface RawPathRegex {
    flags?: unknown;
    regex?: unknown;
}

/** 已通過 JavaScript RegExp validation 的 runtime rule。 */
export interface PathRegex {
    readonly kind: "regex";
    readonly source: string;
    readonly flags: string;
    readonly expression: RegExp;
}

/** 驗證 Regex object；格式錯誤時 fail-soft 回傳 `undefined`。 */
export function normalizePathRegex(value: unknown): PathRegex | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }

    const raw = value as RawPathRegex;
    if (typeof raw.regex !== "string" || raw.regex === "") {
        return undefined;
    }
    if (raw.flags !== undefined && typeof raw.flags !== "string") {
        return undefined;
    }

    try {
        const expression = new RegExp(raw.regex, raw.flags ?? "");
        return {
            kind: "regex",
            source: raw.regex,
            flags: expression.flags,
            expression,
        };
    } catch {
        return undefined;
    }
}

export function isPathRegex(value: unknown): value is PathRegex {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as { kind?: unknown }).kind === "regex"
    );
}

/** 去重與 settings removal 共用的 stable identity。 */
export function pathRegexKey(rule: PathRegex): string {
    return `regex:${rule.source.length}:${rule.source}:${rule.flags}`;
}

/** `Restore Hidden Paths` 使用的可辨識 label。 */
export function formatPathRegex(rule: PathRegex): string {
    return `/${rule.source}/${rule.flags}`;
}

/**
 * 對同一路徑的 absolute / `~/...` variants 執行標準 JavaScript Regex test。
 * `g` / `y` 是 stateful flags，每次 test 前都重設 `lastIndex`。
 */
export function matchesPathRegex(
    rule: PathRegex,
    values: readonly string[]
): boolean {
    for (const value of values) {
        rule.expression.lastIndex = 0;
        if (rule.expression.test(value)) {
            return true;
        }
    }
    return false;
}
