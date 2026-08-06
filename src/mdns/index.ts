import * as vscode from "vscode";
import type { PluginContext } from "../plugin";
import type { MdnsService } from "./types";
import { MdnsRegistry } from "./mdnsRegistry";
import { MulticastDnsTransport } from "./mdnsTransport";
import { MdnsTreeProvider, type MdnsDetail } from "./mdnsTreeProvider";
import { buildMdnsDetailFields } from "./mdnsTreeSpec";
import { resolveConnectCommand } from "../mdnsConnect";
import { registerViewVisibility } from "../plugin/viewVisibility";
import { joinShellCommand } from "../shellCommand";
import { DIAGNOSTIC_METRIC } from "../diagnostics/metrics";

export function register(ctx: PluginContext): void {
    const registry = new MdnsRegistry(new MulticastDnsTransport());
    registry.start();

    const provider = new MdnsTreeProvider(registry);
    provider.start();

    ctx.registerResetHandler(() => {
        registry.reset();
        provider.refresh();
    });
    ctx.registerDiagnosticsProvider(() => ({
        [DIAGNOSTIC_METRIC.mDNSServiceCount]: registry.getAll().length,
    }));

    const view = vscode.window.createTreeView("superset.mdns", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    // Report active view for panel-layout persistence (plan §3).
    const visibilitySub = registerViewVisibility(view, "superset.mdns");

    // Cross-panel reveal-in-tree wiring: mDNS tree is reachable
    // from `superset.revealInTree({ viewId: "superset.mdns", ... })`.
    // Dispose alongside the view in the chain below.
    ctx.registerTreeView(
        "superset.mdns",
        view,
        provider
    );

    const refreshCmd = vscode.commands.registerCommand(
        "superset.mdnsRefresh",
        () => {
            registry.refresh();
            provider.refresh();
        }
    );

    const copyCmd = vscode.commands.registerCommand(
        "superset.mdnsCopy",
        async (svc: MdnsService | undefined) => {
            if (!svc) return;
            const target = svc.host ?? svc.addresses[0];
            if (target) {
                const text =
                    svc.port > 0 ? `${target}:${svc.port}` : target;
                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage(`已複製 ${text}`);
            }
        }
    );

    const copyDetailCmd = vscode.commands.registerCommand(
        "superset.mdnsCopyDetail",
        async (detail: MdnsDetail | undefined) => {
            if (!detail) return;
            await vscode.env.clipboard.writeText(detail.value);
            vscode.window.showInformationMessage(
                `已複製 ${detail.value}`
            );
        }
    );

    const showDetailCmd = vscode.commands.registerCommand(
        "superset.mdnsShowDetail",
        async (svc: MdnsService | undefined) => {
            if (!svc) return;
            const cachedResult = registry.getDetailCached(svc);
            const lines: string[] = [
                `名稱: ${svc.name}`,
                ...cachedResult.detail.map(
                    (f) => `${f.label}: ${f.value}`
                ),
            ];
            const detail = lines.join("\n");

            const copyText = svc.host ?? svc.addresses[0];
            const action = await vscode.window.showInformationMessage(
                detail,
                { modal: true },
                "複製位址"
            );
            if (action === "複製位址" && copyText) {
                const text =
                    svc.port > 0
                        ? `${copyText}:${svc.port}`
                        : copyText;
                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage(`已複製 ${text}`);
            }
        }
    );

    /**
     * One-click Connect — resolves the service type to a connect
     * action via `resolveConnectCommand`. Browser/printer URIs go through
     * `openExternal`; only validated SSH argv reaches a terminal.
     */
    const connectCmd = vscode.commands.registerCommand(
        "superset.mdnsConnect",
        async (svc: MdnsService | undefined) => {
            if (!svc) return;
            const plan = resolveConnectCommand(svc);
            if (!plan) {
                vscode.window.showWarningMessage(
                    `Superset: service "${svc.name}" 的連線資料無效或不安全`
                );
                return;
            }
            if (plan.kind === "external") {
                const opened = await vscode.env.openExternal(
                    vscode.Uri.parse(plan.uri, true)
                );
                if (!opened) {
                    void vscode.window.showWarningMessage(
                        `Superset: 無法開啟 ${plan.uri}`
                    );
                }
                return;
            }
            const cwd =
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
                process.cwd();
            const terminal = ctx.createTerminal(`Connect: ${svc.name}`, cwd);
            terminal.show(true);
            // Defer one tick so the shell prompt has time to mount
            // before we type the command — empirically 200ms is
            // enough for the shell to open.
            const initialCommand = joinShellCommand(plan.cmd, plan.args);
            await new Promise((r) => setTimeout(r, 200));
            terminal.sendText(initialCommand);
        }
    );

    for (const disposable of [
        refreshCmd,
        copyCmd,
        copyDetailCmd,
        showDetailCmd,
        connectCmd,
        view,
        visibilitySub,
        { dispose: () => provider.stop() },
        { dispose: () => registry.stop() },
    ]) {
        ctx.registerDisposable(disposable);
    }
}
