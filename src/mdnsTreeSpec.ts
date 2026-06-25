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

/** A single key-value pair extracted from an MdnsService for display. */
export interface MdnsDetailField {
    readonly label: string;
    readonly value: string;
}

/**
 * Extract all display fields from an MdnsService in presentation order.
 * Shared by the tree detail rows, tooltip markdown, and the modal detail
 * command — a single source of truth for which fields are shown and how
 * their values are formatted.
 */
export function buildMdnsDetailFields(svc: MdnsService): MdnsDetailField[] {
    const fields: MdnsDetailField[] = [
        { label: "類型", value: svc.type },
        { label: "網域", value: svc.domain },
        { label: "主機", value: svc.host ?? "(無)" },
    ];

    if (svc.aliases && svc.aliases.length > 0) {
        fields.push({ label: "別名", value: svc.aliases.join(", ") });
    }

    if (svc.port > 0) {
        fields.push({ label: "埠號", value: String(svc.port) });
    }

    if (svc.addresses.length > 0) {
        fields.push({ label: "位址", value: svc.addresses.join(", ") });
    } else {
        fields.push({ label: "位址", value: "(無)" });
    }

    if (svc.priority > 0 || svc.weight > 0) {
        fields.push({
            label: "優先級 / 權重",
            value: `${svc.priority} / ${svc.weight}`,
        });
    }

    if (svc.ttl > 0) {
        fields.push({ label: "TTL", value: `${svc.ttl} 秒` });
    }

    if (svc.subtypes.length > 0) {
        fields.push({ label: "子類型", value: svc.subtypes.join(", ") });
    }

    if (svc.srcAddress) {
        fields.push({ label: "來源網卡", value: svc.srcAddress });
    }

    if (Object.keys(svc.txt).length > 0) {
        fields.push({
            label: "TXT 屬性",
            value: Object.entries(svc.txt)
                .map(([k, v]) => `${k}=${v}`)
                .join(", "),
        });
    }

    fields.push(
        {
            label: "首次發現",
            value: new Date(svc.firstSeen).toLocaleTimeString(),
        },
        {
            label: "最後更新",
            value: new Date(svc.lastSeen).toLocaleTimeString(),
        }
    );

    return fields;
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