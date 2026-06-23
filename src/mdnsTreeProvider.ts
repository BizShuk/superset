import * as vscode from "vscode";
import type { MdnsListener, MdnsService } from "./types";
import type { MdnsRegistry } from "./mdnsRegistry";
import type { MdnsTypeGroup } from "./mdnsTreeSpec";
import { buildMdnsServiceSpec, buildMdnsTypeSpec } from "./mdnsTreeSpec";

export interface MdnsDetail {
    readonly kind: "mdnsDetail";
    readonly label: string;
    readonly value: string;
    readonly parent: MdnsService;
}

type MdnsTreeElement = MdnsTypeGroup | MdnsService | MdnsDetail;

/**
 * vscode-bound TreeDataProvider for mDNS service discovery.
 * Three-level tree: service types → service instances → detail rows.
 */
export class MdnsTreeProvider
    implements vscode.TreeDataProvider<MdnsTreeElement>
{
    private readonly emitter = new vscode.EventEmitter<
        MdnsTreeElement | MdnsTreeElement[] | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;

    private unsubscribeRegistry?: () => void;

    constructor(private readonly registry: MdnsRegistry) {}

    start(): void {
        if (this.unsubscribeRegistry) return;
        const handler: MdnsListener = () => {
            this.emitter.fire(undefined);
        };
        this.unsubscribeRegistry = this.registry.onDidChange(handler);
    }

    stop(): void {
        this.unsubscribeRegistry?.();
        this.unsubscribeRegistry = undefined;
    }

    refresh(): void {
        this.emitter.fire(undefined);
    }

    getTreeItem(element: MdnsTreeElement): vscode.TreeItem {
        if (isMdnsDetail(element)) {
            return this.buildDetailTreeItem(element);
        }
        if (isMdnsTypeGroup(element)) {
            return this.buildTypeGroupTreeItem(element);
        }
        return this.buildServiceTreeItem(element);
    }

    getChildren(
        element?: MdnsTreeElement
    ): vscode.ProviderResult<MdnsTreeElement[]> {
        if (!element) {
            return this.buildTypeGroups();
        }
        if (isMdnsTypeGroup(element)) {
            return element.services;
        }
        if (isMdnsService(element)) {
            return this.buildDetailRows(element);
        }
        return [];
    }

    getParent(
        element: MdnsTreeElement
    ): vscode.ProviderResult<MdnsTreeElement> {
        if (isMdnsDetail(element)) {
            return element.parent;
        }
        if (isMdnsService(element)) {
            // Find which type group contains this service
            for (const g of this.buildTypeGroups()) {
                if (g.services.includes(element)) {
                    return g;
                }
            }
        }
        return undefined;
    }

    // ── Private builders ───────────────────────────────────

    private buildTypeGroupTreeItem(group: MdnsTypeGroup): vscode.TreeItem {
        const spec = buildMdnsTypeSpec(group);
        const item = new vscode.TreeItem(spec.label);
        item.iconPath = new vscode.ThemeIcon("search");
        item.description = spec.description;
        item.contextValue = spec.contextValue;
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        return item;
    }

    private buildServiceTreeItem(svc: MdnsService): vscode.TreeItem {
        const spec = buildMdnsServiceSpec(svc);
        const item = new vscode.TreeItem(spec.label);
        item.iconPath = new vscode.ThemeIcon("server");
        item.description = spec.description;
        item.contextValue = spec.contextValue;
        // Expandable: clicking toggles detail rows instead of a command
        item.collapsibleState =
            vscode.TreeItemCollapsibleState.Collapsed;
        item.tooltip = new vscode.MarkdownString(
            this.buildTooltipMarkdown(svc)
        );
        return item;
    }

    private buildDetailTreeItem(detail: MdnsDetail): vscode.TreeItem {
        const item = new vscode.TreeItem(detail.label);
        item.description = detail.value;
        item.iconPath = new vscode.ThemeIcon("symbol-property");
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        item.contextValue = "mdnsDetail";
        return item;
    }

    // ── Detail rows ────────────────────────────────────────

    private buildDetailRows(svc: MdnsService): MdnsDetail[] {
        const rows: MdnsDetail[] = [];

        rows.push(d("類型", svc.type, svc));
        rows.push(d("網域", svc.domain, svc));
        rows.push(d("主機", svc.host ?? "(無)", svc));

        if (svc.port > 0) {
            rows.push(d("埠號", String(svc.port), svc));
        }

        if (svc.addresses.length > 0) {
            rows.push(d("位址", svc.addresses.join(", "), svc));
        } else {
            rows.push(d("位址", "(無)", svc));
        }

        if (svc.priority > 0 || svc.weight > 0) {
            rows.push(
                d("優先級 / 權重", `${svc.priority} / ${svc.weight}`, svc)
            );
        }

        if (svc.ttl > 0) {
            rows.push(d("TTL", `${svc.ttl} 秒`, svc));
        }

        if (svc.subtypes.length > 0) {
            rows.push(d("子類型", svc.subtypes.join(", "), svc));
        }

        if (svc.srcAddress) {
            rows.push(d("來源網卡", svc.srcAddress, svc));
        }

        if (Object.keys(svc.txt).length > 0) {
            rows.push(
                d(
                    "TXT 屬性",
                    Object.entries(svc.txt)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", "),
                    svc
                )
            );
        }

        rows.push(
            d(
                "首次發現",
                new Date(svc.firstSeen).toLocaleTimeString(),
                svc
            )
        );
        rows.push(
            d(
                "最後更新",
                new Date(svc.lastSeen).toLocaleTimeString(),
                svc
            )
        );

        return rows;
    }

    // ── Tooltip ────────────────────────────────────────────

    private buildTooltipMarkdown(svc: MdnsService): string {
        const lines: string[] = [
            `**${svc.name}**`,
            "",
            `| 欄位 | 值 |`,
            `|---|---|`,
            `| 類型 | ${svc.type} |`,
            `| 主機 | ${svc.host ?? "(無)"} |`,
            `| 埠號 | ${svc.port} |`,
            `| 位址 | ${svc.addresses.length > 0 ? svc.addresses.join(", ") : "(無)"} |`,
        ];
        if (svc.priority > 0 || svc.weight > 0) {
            lines.push(
                `| 優先級 | ${svc.priority} |`,
                `| 權重 | ${svc.weight} |`
            );
        }
        if (svc.ttl > 0) {
            lines.push(`| TTL | ${svc.ttl} 秒 |`);
        }
        if (svc.subtypes.length > 0) {
            lines.push(`| 子類型 | ${svc.subtypes.join(", ")} |`);
        }
        if (svc.srcAddress) {
            lines.push(`| 來源 | ${svc.srcAddress} |`);
        }
        if (Object.keys(svc.txt).length > 0) {
            lines.push(
                `| TXT | ${Object.entries(svc.txt)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")} |`
            );
        }
        lines.push(
            `| 首次發現 | ${new Date(svc.firstSeen).toLocaleTimeString()} |`,
            `| 最後更新 | ${new Date(svc.lastSeen).toLocaleTimeString()} |`
        );
        return lines.join("\n");
    }

    // ── Type groups ────────────────────────────────────────

    private buildTypeGroups(): MdnsTypeGroup[] {
        const map = new Map<string, MdnsService[]>();
        for (const svc of this.registry.getAll()) {
            const list = map.get(svc.type) ?? [];
            list.push(svc);
            map.set(svc.type, list);
        }
        const groups: MdnsTypeGroup[] = [];
        for (const [type, services] of map) {
            groups.push({ type, services });
        }
        groups.sort((a, b) => a.type.localeCompare(b.type));
        return groups;
    }
}

function d(label: string, value: string, parent: MdnsService): MdnsDetail {
    return { kind: "mdnsDetail", label, value, parent };
}

function isMdnsTypeGroup(e: MdnsTreeElement): e is MdnsTypeGroup {
    return "services" in e;
}

function isMdnsService(e: MdnsTreeElement): e is MdnsService {
    return "type" in e && "port" in e && !("services" in e);
}

function isMdnsDetail(e: MdnsTreeElement): e is MdnsDetail {
    return "kind" in e && (e as MdnsDetail).kind === "mdnsDetail";
}