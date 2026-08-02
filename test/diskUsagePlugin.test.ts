// diskUsagePlugin — Status Bar lifecycle and refresh scheduling.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    statfs: vi.fn(),
    item: {
        text: "",
        tooltip: "",
        shown: 0,
        disposed: 0,
        show() {
            this.shown++;
        },
        dispose() {
            this.disposed++;
        },
    },
}));

vi.mock("node:fs/promises", () => ({ statfs: mocks.statfs }));
vi.mock("vscode", () => ({
    StatusBarAlignment: { Right: 2 },
    window: {
        createStatusBarItem: () => mocks.item,
    },
}));

const { DISK_USAGE_REFRESH_MS, diskUsagePlugin } = await import(
    "../src/diskUsage/plugin"
);

function makeContext() {
    const disposables: Array<{ dispose(): void }> = [];
    const logs: string[] = [];
    return {
        disposables,
        logs,
        ctx: {
            workspaceFolder: "/workspace",
            registerDisposable: (disposable: { dispose(): void }) =>
                disposables.push(disposable),
            log: (message: string) => logs.push(message),
        },
    };
}

async function flushRefresh(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

beforeEach(() => {
    vi.useFakeTimers();
    mocks.statfs.mockReset();
    mocks.statfs.mockResolvedValue({
        bsize: 1024,
        blocks: 100,
        bfree: 25,
        bavail: 20,
    });
    mocks.item.text = "";
    mocks.item.tooltip = "";
    mocks.item.shown = 0;
    mocks.item.disposed = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

describe("diskUsagePlugin", () => {
    it("shows the current volume and refreshes on its interval", async () => {
        const harness = makeContext();
        diskUsagePlugin.activate(harness.ctx as never);
        await flushRefresh();

        expect(mocks.statfs).toHaveBeenCalledWith("/workspace");
        expect(mocks.item.text).toBe("$(database) Disk 80%");
        expect(mocks.item.tooltip).toContain("Used: 80.0 KiB / 100 KiB");
        expect(mocks.item.shown).toBe(1);

        await vi.advanceTimersByTimeAsync(DISK_USAGE_REFRESH_MS);
        expect(mocks.statfs).toHaveBeenCalledTimes(2);
        expect(mocks.item.shown).toBe(2);

        for (const disposable of harness.disposables) disposable.dispose();
        expect(mocks.item.disposed).toBe(1);
    });

    it("keeps a readable fallback when statfs fails", async () => {
        mocks.statfs.mockRejectedValueOnce(new Error("EACCES"));
        const harness = makeContext();
        diskUsagePlugin.activate(harness.ctx as never);
        await flushRefresh();

        expect(mocks.item.text).toBe("$(database) Disk —");
        expect(mocks.item.tooltip).toContain("EACCES");
        expect(harness.logs.some((log) => log.includes("statfs failed"))).toBe(
            true
        );

        for (const disposable of harness.disposables) disposable.dispose();
    });
});
