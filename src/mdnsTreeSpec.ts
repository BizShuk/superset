import type { MdnsService } from "./types";

export type MdnsIconKind = "service" | "serviceType";

export interface MdnsTreeItemSpec {
    label: string;
    iconKind: MdnsIconKind;
    description?: string;
    contextValue: "mdnsService" | "mdnsType";
}

export interface MdnsTypeGroup {
    readonly type: string;
    readonly services: MdnsService[];
}

/**
 * Build a TreeItem spec for an mDNS service instance.
 */
export function buildMdnsServiceSpec(svc: MdnsService): MdnsTreeItemSpec {
    const addr = svc.host ?? svc.addresses[0] ?? "?";
    let desc =
        addr === "?"
            ? "?"
            : svc.port > 0
              ? `${addr}:${svc.port}`
              : addr;
    // Append priority/weight if non-default (both 0 = default)
    if (svc.priority > 0 || svc.weight > 0) {
        desc += ` (p:${svc.priority} w:${svc.weight})`;
    }
    // Append TTL if present
    if (svc.ttl > 0) {
        desc += ` TTL:${svc.ttl}s`;
    }
    return {
        label: svc.name,
        iconKind: "service",
        description: desc,
        contextValue: "mdnsService",
    };
}

/**
 * Build a TreeItem spec for a service type group (e.g., "_http._tcp").
 */
export function buildMdnsTypeSpec(group: MdnsTypeGroup): MdnsTreeItemSpec {
    return {
        label: group.type,
        iconKind: "serviceType",
        description: `${group.services.length} 個服務`,
        contextValue: "mdnsType",
    };
}