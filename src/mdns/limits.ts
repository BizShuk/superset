import { Buffer } from "node:buffer";

export const MAX_RECORDS_PER_PACKET = 256;
export const MAX_PENDING_SERVICES = 512;
export const MAX_STORED_SERVICES = 512;
export const MAX_DNS_NAME_BYTES = 255;
export const MAX_SERVICE_VALUES = 32;
export const MAX_TXT_ENTRIES = 64;
export const MAX_TXT_KEY_BYTES = 128;
export const MAX_TXT_VALUE_BYTES = 1024;
export const MAX_TTL_SECONDS = 4_500;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const TXT_KEY = /^[\u0021-\u003c\u003e-\u007e]+$/u;
const BLOCKED_OBJECT_KEYS = new Set([
    "__proto__",
    "constructor",
    "prototype",
]);

export function isBoundedText(value: unknown, maxBytes: number): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        !CONTROL_CHARACTER.test(value) &&
        Buffer.byteLength(value, "utf8") <= maxBytes
    );
}

export function isDnsName(value: unknown): value is string {
    if (!isBoundedText(value, MAX_DNS_NAME_BYTES)) return false;

    const withoutTrailingDot = value.endsWith(".") ? value.slice(0, -1) : value;
    if (!withoutTrailingDot) return false;

    return withoutTrailingDot.split(".").every((label) => {
        const bytes = Buffer.byteLength(label, "utf8");
        return bytes > 0 && bytes <= 63;
    });
}

export function validServicePort(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 65_535
    );
}

export function boundedUniqueLatest(
    values: readonly string[],
    limit: number = MAX_SERVICE_VALUES
): string[] {
    const unique = new Set<string>();
    for (const value of values) {
        if (typeof value !== "string") continue;
        if (unique.has(value)) continue;
        unique.add(value);
        if (unique.size > limit) {
            const oldest = unique.values().next().value;
            if (oldest !== undefined) unique.delete(oldest);
        }
    }
    return Array.from(unique);
}

function validTxtEntry(key: unknown, value: unknown): value is string {
    return (
        typeof key === "string" &&
        typeof value === "string" &&
        !BLOCKED_OBJECT_KEYS.has(key) &&
        TXT_KEY.test(key) &&
        Buffer.byteLength(key, "utf8") <= MAX_TXT_KEY_BYTES &&
        !CONTROL_CHARACTER.test(value) &&
        Buffer.byteLength(value, "utf8") <= MAX_TXT_VALUE_BYTES
    );
}

export function mergeBoundedTxt(
    ...sources: ReadonlyArray<Readonly<Record<string, string>> | undefined>
): Record<string, string> {
    const merged = new Map<string, string>();

    for (const source of sources) {
        if (!source || typeof source !== "object") continue;

        let keys: string[];
        try {
            keys = Object.keys(source);
        } catch {
            continue;
        }

        for (const key of keys.slice(0, MAX_TXT_ENTRIES)) {
            let value: unknown;
            try {
                value = source[key];
            } catch {
                continue;
            }
            if (!validTxtEntry(key, value)) continue;

            merged.delete(key);
            merged.set(key, value);
            if (merged.size > MAX_TXT_ENTRIES) {
                const oldest = merged.keys().next().value;
                if (oldest !== undefined) merged.delete(oldest);
            }
        }
    }

    return Object.fromEntries(merged);
}

export function clampAdvertisedTtl(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(Math.floor(value), MAX_TTL_SECONDS);
}

export function effectiveTtlSeconds(
    advertised: number,
    fallback: number
): number {
    return clampAdvertisedTtl(advertised) || clampAdvertisedTtl(fallback);
}
