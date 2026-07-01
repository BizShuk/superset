// TopologyTransformer — pure Raw Scan Data → `TopologyNode[]` transform.
// No I/O, no scanner, no state. Extracted from `TopologyStore.scan()`
// (which was 171 lines) so the per-section assembly logic can be
// unit-tested in isolation, and so the store can be reduced to "call
// the scanner, hand the result to the transformer, persist".
//
// The shape of the output (`TopologyNode[]`) is intentionally a
// `vscode.TreeItem`-friendly structure (label / description / children).
// That coupling is a known tech-debt noted in
// `plans/architecture-topology.md` §1 — for now we keep the shape so
// the existing `topologyStore.test.ts` continues to pass without
// modification.

import type {
    ArpEntry,
    NetworkInterface,
    TracerouteHop,
} from "./topologyScanner";
import type { TopologyNode } from "./types";
import { deriveLocalIp } from "./localIp";

/** Inputs to a single transform pass — the output of one `ScannerTransport` fan-out. */
export interface ScanInputs {
    interfaces: NetworkInterface[];
    gateway: string | null;
    hops: TracerouteHop[] | null;
    dnsServers: string[];
    arp: ArpEntry[];
}

/** Compute the `/24` subnet for an IPv4 address. Non-IPv4 input
 *  is returned unchanged so the caller's `Unreachable` literal still
 *  matches the group label. */
function subnet24(ip: string): string {
    const parts = ip.split(".");
    if (parts.length !== 4) return ip;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

/**
 * Walk to the deepest `parent.children` whose last child is a subnet
 * group, mirroring the original `insertInto` algorithm in
 * `TopologyStore.scan()`. Recursion stops at the first parent whose
 * last child has no children, has empty children, or whose last
 * child's label is `Unreachable` / does not include `/`.
 */
function insertInto(parent: TopologyNode, node: TopologyNode): TopologyNode {
    if (!parent.children || parent.children.length === 0) {
        return parent;
    }
    const last = parent.children[parent.children.length - 1];
    if (
        last.children &&
        last.children.length > 0 &&
        last.label !== "Unreachable" &&
        last.label.includes("/")
    ) {
        return insertInto(last, node);
    }
    return parent;
}

/** Build the "Local Interfaces" root. */
function buildInterfacesNode(interfaces: NetworkInterface[]): TopologyNode | null {
    const children: TopologyNode[] = [];

    // Non-internal IPv4 first.
    for (const iface of interfaces) {
        for (const addr of iface.addresses) {
            if (addr.internal) continue;
            if (addr.family !== "IPv4") continue;
            const v6 = iface.addresses
                .filter((a) => a.family === "IPv6" && !a.internal)
                .map((a) => a.address)
                .join(", ");
            const desc = v6
                ? `${addr.address} (${addr.mac ?? "?"}) [${v6}]`
                : `${addr.address} (${addr.mac ?? "?"})`;
            children.push({ label: `${iface.name}: ${desc}` });
        }
    }
    // Loopback entries next.
    for (const iface of interfaces) {
        for (const addr of iface.addresses) {
            if (addr.internal) {
                children.push({
                    label: `${iface.name}: ${addr.address} (loopback)`,
                });
            }
        }
    }

    if (children.length === 0) return null;
    return { label: "Local Interfaces", children };
}

/** Build the trace-root node, grouping hops by /24 subnet. Returns
 *  `null` when there are no hops and no derivable local IP — matches
 *  the original "skip prepending when no usable IPv4 exists" path. */
function buildTraceNode(
    rawHops: TracerouteHop[] | null,
    interfaces: NetworkInterface[],
    gateway: string | null
): TopologyNode | null {
    const localIp = deriveLocalIp(interfaces, gateway);
    const hops: TracerouteHop[] =
        rawHops && rawHops.length > 0 && localIp && !rawHops.some((h) => h.ip === localIp)
            ? [{ hop: "0", ip: localIp, time: "", role: "local" }, ...rawHops]
            : (rawHops ?? []);
    if (hops.length === 0) return null;

    const target = "8.8.8.8";
    const traceRoot: TopologyNode = { label: `Trace ${target}`, children: [] };

    let currentSubnet = hops[0]!.ip === "*" ? "Unreachable" : subnet24(hops[0]!.ip);
    let currentGroup: TopologyNode = { label: currentSubnet, children: [] };

    const hopDesc = (h: TracerouteHop): string | undefined =>
        h.role === "local" ? "本機" : h.time || undefined;

    for (const h of hops) {
        const subnet = h.ip === "*" ? "Unreachable" : subnet24(h.ip);
        if (subnet !== currentSubnet) {
            if (currentGroup.children && currentGroup.children.length > 0) {
                const targetParent = insertInto(traceRoot, currentGroup);
                targetParent.children!.push(currentGroup);
            }
            const newGroup: TopologyNode = { label: subnet, children: [] };
            if (h.ip === "*") {
                newGroup.children!.push({ label: "* * *" });
            } else {
                newGroup.children!.push({
                    label: h.ip,
                    description: hopDesc(h),
                });
            }
            currentSubnet = subnet;
            currentGroup = newGroup;
        } else {
            if (h.ip === "*") {
                currentGroup.children!.push({ label: "* * *" });
            } else {
                currentGroup.children!.push({
                    label: h.ip,
                    description: hopDesc(h),
                });
            }
        }
    }

    if (currentGroup.children && currentGroup.children.length > 0) {
        const targetParent = insertInto(traceRoot, currentGroup);
        targetParent.children!.push(currentGroup);
    }

    return traceRoot;
}

/** Build the "Routing" root with gateway + trace children. */
function buildRoutingNode(
    gateway: string | null,
    trace: TopologyNode | null
): TopologyNode | null {
    const children: TopologyNode[] = [];
    if (gateway) {
        children.push({ label: "Default Gateway", description: gateway });
    }
    if (trace) {
        children.push(trace);
    }
    if (children.length === 0) return null;
    return { label: "Routing", children };
}

/** Build the "DNS Servers" root. */
function buildDnsNode(dnsServers: string[]): TopologyNode | null {
    if (dnsServers.length === 0) return null;
    return {
        label: "DNS Servers",
        children: dnsServers.map((s) => ({ label: s })),
    };
}

/** Build the "ARP Table" root. */
function buildArpNode(arp: ArpEntry[]): TopologyNode | null {
    if (arp.length === 0) return null;
    return {
        label: "ARP Table",
        children: arp.map((a) => ({
            label: a.ip,
            description: a.mac,
        })),
    };
}

/**
 * Compose the final `TopologyNode[]` from a fan-out of scanner
 * results. Returns nodes in the canonical order:
 *   Local Interfaces → Routing → DNS Servers → ARP Table
 * Sections with no data are dropped (matches the pre-refactor
 * conditional pushes).
 */
export function transformScan(inputs: ScanInputs): TopologyNode[] {
    const nodes: TopologyNode[] = [];
    const interfaces = buildInterfacesNode(inputs.interfaces);
    if (interfaces) nodes.push(interfaces);
    const trace = buildTraceNode(inputs.hops, inputs.interfaces, inputs.gateway);
    const routing = buildRoutingNode(inputs.gateway, trace);
    if (routing) nodes.push(routing);
    const dns = buildDnsNode(inputs.dnsServers);
    if (dns) nodes.push(dns);
    const arp = buildArpNode(inputs.arp);
    if (arp) nodes.push(arp);
    return nodes;
}
