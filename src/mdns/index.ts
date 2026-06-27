import * as vscode from "vscode";
import type { FeatureContext, FeatureHandle } from "../shared";
import type { MdnsService } from "./types";
import { MdnsRegistry } from "./mdnsRegistry";
import { MulticastDnsTransport } from "./mdnsTransport";
import { MdnsTreeProvider, type MdnsDetail } from "./mdnsTreeProvider";
import { buildMdnsDetailFields } from "./mdnsTreeSpec";

export function register(ctx: FeatureContext): FeatureHandle {
    const registry = new MdnsRegistry(new MulticastDnsTransport());
    registry.start();

    const provider = new MdnsTreeProvider(registry);
    provider.start();

    const view = vscode.window.createTreeView("superset.mdns", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

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
            const lines: string[] = [
                `名稱: ${svc.name}`,
                ...buildMdnsDetailFields(svc).map(
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

    ctx.subscriptions.push(
        refreshCmd,
        copyCmd,
        copyDetailCmd,
        showDetailCmd,
        view,
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
            view.dispose();
        },
    };
}
