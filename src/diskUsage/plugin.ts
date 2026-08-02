// diskUsagePlugin — periodically reports the current workspace volume's
// capacity in a dedicated Status Bar Item.

import * as vscode from "vscode";
import { statfs } from "node:fs/promises";
import { type ExtensionPlugin, type PluginContext } from "../plugin";
import {
    calculateDiskUsage,
    renderDiskUsage,
    renderDiskUsageError,
    type StatFsResult,
} from "./usage";

export const DISK_USAGE_PLUGIN_ID = "diskUsage";
export const DISK_USAGE_REFRESH_MS = 30_000;

export const diskUsagePlugin: ExtensionPlugin = {
    id: DISK_USAGE_PLUGIN_ID,
    name: "Disk Usage",

    activate(pCtx: PluginContext): void {
        const statusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            90
        );
        let active = true;

        const refresh = async (): Promise<void> => {
            try {
                const stats = (await statfs(pCtx.workspaceFolder)) as StatFsResult;
                if (!active) return;
                const render = renderDiskUsage(
                    pCtx.workspaceFolder,
                    calculateDiskUsage(stats)
                );
                statusItem.text = render.text;
                statusItem.tooltip = render.tooltip;
            } catch (error) {
                if (!active) return;
                const render = renderDiskUsageError(
                    pCtx.workspaceFolder,
                    error
                );
                statusItem.text = render.text;
                statusItem.tooltip = render.tooltip;
                pCtx.log(`diskUsage: statfs failed: ${error}`);
            }
            statusItem.show();
        };

        const timer = setInterval(() => {
            void refresh();
        }, DISK_USAGE_REFRESH_MS);
        timer.unref?.();

        // Stop the timer before the Status Bar Item is disposed. The active
        // guard also prevents an in-flight statfs result from touching a
        // retired item during extension shutdown.
        pCtx.registerDisposable({
            dispose: () => {
                active = false;
                clearInterval(timer);
            },
        });
        pCtx.registerDisposable(statusItem);

        void refresh();
        pCtx.log(`diskUsage: registered (path=${pCtx.workspaceFolder})`);
    },

    deactivate(): void {
        // Timer and Status Bar Item are released through PluginContext.
    },
};
