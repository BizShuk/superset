import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import type { MdnsService } from "./types";
import { MdnsRegistry } from "./mdnsRegistry";
import { MulticastDnsTransport } from "./mdnsTransport";
import { MdnsTreeProvider, type MdnsDetail } from "./mdnsTreeProvider";
import { buildMdnsDetailFields } from "./mdnsTreeSpec";
import { resolveConnectCommand } from "../mdnsConnect";
import { getTerminalSpawner } from "../crossModuleState";
import { getTreeViewRegistry } from "../plugin/treeViewRegistry";

export function register(ctx: FeatureContext): FeatureHandle {
    const registry = new MdnsRegistry(new MulticastDnsTransport());
    registry.start();

    const provider = new MdnsTreeProvider(registry);
    provider.start();

    ctx.resetHandlers.push(() => {
        registry.reset();
        provider.refresh();
    });

    const view = vscode.window.createTreeView("superset.mdns", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    // Report active view for panel-layout persistence (plan §3).
    const visibilitySub = view.onDidChangeVisibility((visible) => {
        if (visible) {
            void vscode.commands.executeCommand(
                "superset.reportViewVisible",
                "superset.mdns"
            );
        }
    });

    // Cross-panel reveal-in-tree wiring: mDNS tree is reachable
    // from `superset.revealInTree({ viewId: "superset.mdns", ... })`.
    // Dispose alongside the view in the chain below.
    const treeViewEntry = getTreeViewRegistry()?.register(
        "superset.mdns",
        view as unknown as vscode.TreeView<unknown>,
        provider as unknown as vscode.TreeDataProvider<unknown>,
        ctx.shared.log
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
     * command (ssh for `_ssh._tcp`, open for `_http(s)` / `_ipp(s)`)
     * via `resolveConnectCommand`, then spawns a fresh PTY-backed
     * terminal and writes the command into it. Falls back to a
     * warning for unrecognised service types.
     */
    const connectCmd = vscode.commands.registerCommand(
        "superset.mdnsConnect",
        async (svc: MdnsService | undefined) => {
            if (!svc) return;
            const plan = resolveConnectCommand(svc);
            if (!plan) {
                vscode.window.showWarningMessage(
                    `Superset: 未知 service type "${svc.type}",無法連線`
                );
                return;
            }
            const spawn = getTerminalSpawner();
            if (!spawn) {
                vscode.window.showErrorMessage(
                    "Superset: Terminals 模組尚未啟用,請稍候再試"
                );
                return;
            }
            const cwd =
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
                process.cwd();
            const terminal = spawn(`Connect: ${svc.name}`, cwd);
            terminal.show(true);
            // Defer one tick so the shell prompt has time to mount
            // before we type the command — empirically 200ms is
            // enough for the PTY-backed host to open.
            const initialCommand = [plan.cmd, ...plan.args].join(" ");
            await new Promise((r) => setTimeout(r, 200));
            terminal.sendText(initialCommand);
        }
    );

    ctx.subscriptions.push(
        refreshCmd,
        copyCmd,
        copyDetailCmd,
        showDetailCmd,
        connectCmd,
        view,
        visibilitySub,
        // TreeViewRegistry entry — disposed alongside the view so
        // `superset.revealInTree` can't walk a stale panel.
        treeViewEntry ?? { dispose: () => undefined },
        { dispose: () => provider.stop() },
        { dispose: () => registry.stop() }
    );

    return {
        dispose() {
            provider.stop();
            registry.stop();
            refreshCmd.dispose();
            copyCmd.dispose();
            copyDetailCmd.dispose();
            showDetailCmd.dispose();
            connectCmd.dispose();
            view.dispose();
        },
    };
}
