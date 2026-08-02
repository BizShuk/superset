// diskUsage/usage — pure disk-capacity calculations and Status Bar wording.
// Keeping the filesystem result separate from VS Code makes the boundary
// deterministic and easy to test.

export interface StatFsResult {
    readonly bsize: number | bigint;
    readonly blocks: number | bigint;
    readonly bfree: number | bigint;
    /** Available blocks for the current user, when the platform provides it. */
    readonly bavail?: number | bigint;
}

export interface DiskUsage {
    readonly totalBytes: number;
    readonly freeBytes: number;
    readonly usedBytes: number;
    readonly usedPercent: number;
}

export interface DiskUsageRender {
    readonly text: string;
    readonly tooltip: string;
}

function finiteNumber(value: number | bigint): number {
    const result = typeof value === "bigint" ? Number(value) : value;
    return Number.isFinite(result) && result >= 0 ? result : 0;
}

/** Convert a Node `statfs` response into bounded, user-facing numbers. */
export function calculateDiskUsage(stats: StatFsResult): DiskUsage {
    const blockSize = finiteNumber(stats.bsize);
    const totalBytes = blockSize * finiteNumber(stats.blocks);
    const freeBlocks = finiteNumber(stats.bavail ?? stats.bfree);
    const freeBytes = Math.min(totalBytes, blockSize * freeBlocks);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPercent =
        totalBytes > 0
            ? Math.min(100, Math.max(0, Math.round((usedBytes / totalBytes) * 100)))
            : 0;

    return { totalBytes, freeBytes, usedBytes, usedPercent };
}

function formatBytes(bytes: number): string {
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }

    if (unit === 0) return `${Math.round(value)} ${units[unit]}`;
    const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${units[unit]}`;
}

/** Render compact Status Bar text plus the detailed hover tooltip. */
export function renderDiskUsage(path: string, usage: DiskUsage): DiskUsageRender {
    return {
        text: `$(database) Disk ${usage.usedPercent}%`,
        tooltip:
            `Disk usage for ${path}\n` +
            `Used: ${formatBytes(usage.usedBytes)} / ${formatBytes(usage.totalBytes)}\n` +
            `Free: ${formatBytes(usage.freeBytes)}\n` +
            "Updates every 30 seconds.",
    };
}

export function renderDiskUsageError(path: string, error: unknown): DiskUsageRender {
    const message = error instanceof Error ? error.message : String(error);
    return {
        text: "$(database) Disk —",
        tooltip: `Disk usage unavailable for ${path}\n${message}`,
    };
}
