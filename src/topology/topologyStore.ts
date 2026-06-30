import type { TopologyChange, TopologyListener, TopologyNode } from "./types";
import type { ScannerTransport, TracerouteHop } from "./topologyScanner";
import { deriveLocalIp } from "./localIp";

function subnet24(ip: string): string {
    const parts = ip.split(".");
    if (parts.length !== 4) return ip;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

/**
 * Pure data layer for network topology.
 * No `vscode` imports — the scanner is injected.
 */
export class TopologyStore {
    private nodes: TopologyNode[] = [];
    private listeners = new Set<TopologyListener>();
    private scanning = false;
    private activeScanPromise: Promise<void> | null = null;

    constructor(private readonly scanner: ScannerTransport) {}

    start(): void {
        // No-op: scan is triggered on-demand by the user.
    }

    stop(): void {
        this.nodes = [];
        this.listeners.clear();
        this.scanning = false;
        this.activeScanPromise = null;
    }

    reset(): void {
        this.nodes = [];
        this.scanning = false;
        this.activeScanPromise = null;
        this.emit({ type: "scanned", nodes: [] });
    }

    getRoots(): TopologyNode[] {
        return this.nodes;
    }

    scan(): Promise<void> {
        if (this.activeScanPromise) {
            return this.activeScanPromise;
        }

        this.activeScanPromise = (async () => {
            this.scanning = true;
            try {
                const [interfaces, gateway, hops, dnsServers, arp] =
                    await Promise.all([
                        this.scanner.listInterfaces(),
                        this.scanner.getDefaultGateway(),
                        this.scanner.traceroute("8.8.8.8"),
                        this.scanner.resolveDnsServers(),
                        this.scanner.listArpTable(),
                    ]);

                const nodes: TopologyNode[] = [];

                // 1. Local Interfaces
                const interfaceChildren: TopologyNode[] = [];
                for (const iface of interfaces) {
                    for (const addr of iface.addresses) {
                        if (addr.internal) continue;
                        const v6 = iface.addresses
                            .filter((a) => a.family === "IPv6" && !a.internal)
                            .map((a) => a.address)
                            .join(", ");
                        const desc =
                            addr.family === "IPv4"
                                ? v6
                                    ? `${addr.address} (${addr.mac ?? "?"}) [${v6}]`
                                    : `${addr.address} (${addr.mac ?? "?"})`
                                : addr.address;
                        if (addr.family === "IPv4") {
                            interfaceChildren.push({ label: `${iface.name}: ${desc}` });
                        }
                    }
                }
                // Add loopback
                for (const iface of interfaces) {
                    for (const addr of iface.addresses) {
                        if (addr.internal) {
                            interfaceChildren.push({
                                label: `${iface.name}: ${addr.address} (loopback)`,
                            });
                        }
                    }
                }
                if (interfaceChildren.length > 0) {
                    nodes.push({ label: "Local Interfaces", children: interfaceChildren });
                }

                // 2. Routing
                const routeChildren: TopologyNode[] = [];
                if (gateway) {
                    routeChildren.push({ label: "Default Gateway", description: gateway });
                }

                // Traceroute hops may be missing the host's own IP — `traceroute`
                // emits from the default gateway onward, never from itself. We
                // prepend a local hop when one is derivable so the trace is
                // visually complete ("host → gateway → …").
                const localIp = deriveLocalIp(interfaces, gateway);
                const traceHops: TracerouteHop[] =
                    hops && hops.length > 0 && localIp && !hops.some((h) => h.ip === localIp)
                        ? [{ hop: "0", ip: localIp, time: "", role: "local" }, ...hops]
                        : (hops ?? []);

                if (traceHops.length > 0) {
                    const target = "8.8.8.8";
                    const traceRoot: TopologyNode = { label: `Trace ${target}`, children: [] };

                    let currentSubnet = traceHops[0].ip === "*" ? "Unreachable" : subnet24(traceHops[0].ip);
                    let currentGroup: TopologyNode = {
                        label: currentSubnet,
                        children: [],
                    };

                    const insertInto = (
                        parent: TopologyNode,
                        node: TopologyNode
                    ): TopologyNode => {
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
                    };

                    const hopDesc = (h: TracerouteHop): string | undefined =>
                        h.role === "local" ? "本機" : (h.time || undefined);

                    for (const h of traceHops) {
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

                    routeChildren.push(traceRoot);
                }
                if (routeChildren.length > 0) {
                    nodes.push({ label: "Routing", children: routeChildren });
                }

                // 3. DNS Servers
                if (dnsServers && dnsServers.length > 0) {
                    nodes.push({
                        label: "DNS Servers",
                        children: dnsServers.map((s) => ({ label: s })),
                    });
                }

                // 4. ARP Table
                if (arp && arp.length > 0) {
                    nodes.push({
                        label: "ARP Table",
                        children: arp.map((a) => ({
                            label: a.ip,
                            description: a.mac,
                        })),
                    });
                }

                this.nodes = nodes;
                this.emit({ type: "scanned", nodes: this.nodes });
            } finally {
                this.scanning = false;
                this.activeScanPromise = null;
            }
        })();

        return this.activeScanPromise;
    }

    onDidChange(listener: TopologyListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(change: TopologyChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }
}