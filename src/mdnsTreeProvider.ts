import * as vscode from "vscode";
import type { MdnsListener, MdnsService } from "./types";
import type { MdnsRegistry } from "./mdnsRegistry";
import type { MdnsTypeGroup } from "./mdnsTreeSpec";
import { buildMdnsServiceSpec, buildMdnsTypeSpec, buildMdnsDetailFields } from "./mdnsTreeSpec";

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
        return buildMdnsDetailFields(svc).map((f) => d(f.label, f.value, svc));
    }

    // ── Tooltip ────────────────────────────────────────────

    private buildTooltipMarkdown(svc: MdnsService): string {
        const lines: string[] = [
            `**${svc.name}**`,
            "",
            `| 欄位 | 值 |`,
            `|---|---|`,
        ];
        for (const f of buildMdnsDetailFields(svc)) {
            lines.push(`| ${f.label} | ${f.value} |`);
        }
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