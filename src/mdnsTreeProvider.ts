import * as vscode from "vscode";
import type { MdnsListener, MdnsService } from "./types";
import type { MdnsRegistry } from "./mdnsRegistry";
import type { MdnsTypeGroup } from "./mdnsTreeSpec";
import { buildMdnsServiceSpec, buildMdnsTypeSpec } from "./mdnsTreeSpec";

type MdnsTreeElement = MdnsTypeGroup | MdnsService;

/**
 * vscode-bound TreeDataProvider for mDNS service discovery.
 * Two-level tree: service types → service instances.
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
        if (isMdnsTypeGroup(element)) {
            const spec = buildMdnsTypeSpec(element);
            const item = new vscode.TreeItem(spec.label);
            item.iconPath = new vscode.ThemeIcon("search");
            item.description = spec.description;
            item.contextValue = spec.contextValue;
            item.collapsibleState =
                vscode.TreeItemCollapsibleState.Expanded;
            return item;
        }
        const spec = buildMdnsServiceSpec(element);
        const item = new vscode.TreeItem(spec.label);
        item.iconPath = new vscode.ThemeIcon("server");
        item.description = spec.description;
        item.contextValue = spec.contextValue;
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        item.command = {
            command: "superset.mdnsCopy",
            title: "Copy Service Address",
            arguments: [element],
        };
        return item;
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
        return [];
    }

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

function isMdnsTypeGroup(e: MdnsTreeElement): e is MdnsTypeGroup {
    return "services" in e;
}