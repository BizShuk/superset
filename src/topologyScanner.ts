import * as os from "os";
import * as dns from "dns";
import { exec } from "child_process";
import type { TopologyNode } from "./types";
import type { TopologyScanner } from "./topologyStore";

function execAsync(cmd: string): Promise<string> {
    return new Promise((resolve) => {
        exec(cmd, { timeout: 10000 }, (err, stdout) => {
            if (err) {
                resolve("");
                return;
            }
            resolve(stdout.trim());
        });
    });
}

function child(label: string, description?: string): TopologyNode {
    return { label, description };
}

function group(
    label: string,
    children: TopologyNode[]
): TopologyNode {
    return { label, children };
}

/** Extract the /24 subnet from an IPv4 address. */
function subnet24(ip: string): string {
    const parts = ip.split(".");
    if (parts.length !== 4) return ip;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

/**
 * Platform-aware network topology scanner.
 * Uses Node.js built-in modules and system commands.
 */
export class NodeTopologyScanner implements TopologyScanner {
    async scan(): Promise<TopologyNode[]> {
        const [interfaces, gateway, trace, dnsServers, arp] =
            await Promise.all([
                this.scanInterfaces(),
                this.scanGateway(),
                this.scanTraceroute(),
                this.scanDns(),
                this.scanArp(),
            ]);

        const nodes: TopologyNode[] = [];

        if (interfaces.children && interfaces.children.length > 0) {
            nodes.push(interfaces);
        }

        const routeChildren: TopologyNode[] = [];
        if (gateway) {
            routeChildren.push(gateway);
        }
        if (trace.children && trace.children.length > 0) {
            routeChildren.push(trace);
        }
        if (routeChildren.length > 0) {
            nodes.push(group("Routing", routeChildren));
        }

        if (dnsServers.children && dnsServers.children.length > 0) {
            nodes.push(dnsServers);
        }

        if (arp.children && arp.children.length > 0) {
            nodes.push(arp);
        }

        return nodes;
    }

    // ── Local interfaces ───────────────────────────────────

    private async scanInterfaces(): Promise<TopologyNode> {
        const ifaces = os.networkInterfaces();
        const children: TopologyNode[] = [];
        for (const [name, addrs] of Object.entries(ifaces)) {
            if (!addrs) continue;
            for (const addr of addrs) {
                if (addr.internal) continue;
                const v6 = addrs
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
                    children.push(child(`${name}: ${desc}`));
                }
            }
        }
        // Add loopback
        for (const [name, addrs] of Object.entries(ifaces)) {
            if (!addrs) continue;
            for (const addr of addrs) {
                if (addr.internal) {
                    children.push(
                        child(`${name}: ${addr.address} (loopback)`)
                    );
                }
            }
        }
        return group("Local Interfaces", children);
    }

    // ── Default gateway ────────────────────────────────────

    private async scanGateway(): Promise<TopologyNode | null> {
        const platform = process.platform;
        let cmd: string;
        if (platform === "darwin") {
            cmd = "route -n get default 2>/dev/null | awk '/gateway:/ {print $2}'";
        } else if (platform === "linux") {
            cmd = "ip route show default 2>/dev/null | awk '/default via/ {print $3}'";
        } else {
            cmd = "route print 0.0.0.0 2>nul | findstr /R \"0.0.0.0.*0.0.0.0\"";
        }

        const out = await execAsync(cmd);
        const gw = out.split("\n")[0]?.trim();
        if (!gw) return null;

        return child("Default Gateway", gw);
    }

    // ── Traceroute ─────────────────────────────────────────

    private async scanTraceroute(): Promise<TopologyNode> {
        const platform = process.platform;
        const target = "8.8.8.8";
        let cmd: string;
        if (platform === "win32") {
            cmd = `tracert -d -h 10 -w 1000 ${target}`;
        } else {
            cmd = `traceroute -n -m 10 -w 1 ${target} 2>/dev/null`;
        }

        const out = await execAsync(cmd);
        const lines = out.split("\n").slice(1); // skip header
        const hops: Array<{ hop: string; ip: string; time: string }> = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parts = trimmed.split(/\s+/);
            const hop = parts[0];
            const ip = parts[1];
            const time = parts.length > 2 ? parts.slice(2).join(" ") : "";
            if (ip && ip !== "*") {
                hops.push({ hop, ip, time });
            } else if (trimmed.includes("*")) {
                hops.push({ hop, ip: "*", time: "" });
            }
        }

        // Group consecutive hops by /24 subnet
        const subnetGroups: TopologyNode[] = [];
        let currentSubnet = "";
        let currentGroup: TopologyNode[] = [];

        for (const h of hops) {
            const subnet = h.ip === "*" ? "*" : subnet24(h.ip);
            if (subnet !== currentSubnet) {
                if (currentGroup.length > 0) {
                    subnetGroups.push(
                        group(currentSubnet, currentGroup)
                    );
                }
                currentSubnet = subnet;
                currentGroup = [];
            }
            if (h.ip === "*") {
                currentGroup.push(child(`${h.hop}: * * *`));
            } else {
                currentGroup.push(
                    child(`${h.hop}: ${h.ip}`, h.time || undefined)
                );
            }
        }
        if (currentGroup.length > 0) {
            subnetGroups.push(group(currentSubnet, currentGroup));
        }

        return group(`Trace ${target}`, subnetGroups);
    }

    // ── DNS servers ────────────────────────────────────────

    private async scanDns(): Promise<TopologyNode> {
        const servers = dns.getServers();
        const children = servers.map((s) => child(s));
        return group("DNS Servers", children);
    }

    // ── ARP table ──────────────────────────────────────────

    private async scanArp(): Promise<TopologyNode> {
        const platform = process.platform;
        let cmd: string;
        if (platform === "win32") {
            cmd = "arp -a";
        } else {
            cmd = "arp -a 2>/dev/null";
        }

        const out = await execAsync(cmd);
        const lines = out.split("\n");
        const children: TopologyNode[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // macOS: "? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]"
            // Linux: "? (192.168.1.1) at aa:bb:cc:dd:ee:ff [ether] on eth0"
            const macMatch = trimmed.match(
                /\(([\d.]+)\)\s+at\s+([0-9a-f:]+)/i
            );
            if (macMatch) {
                children.push(
                    child(macMatch[1], macMatch[2])
                );
                continue;
            }

            // Windows: "192.168.1.1          aa-bb-cc-dd-ee-ff     dynamic"
            const winMatch = trimmed.match(
                /^([\d.]+)\s+([0-9a-f-]+)\s+/i
            );
            if (winMatch) {
                children.push(
                    child(winMatch[1], winMatch[2].replace(/-/g, ":"))
                );
            }
        }

        return group("ARP Table", children);
    }
}