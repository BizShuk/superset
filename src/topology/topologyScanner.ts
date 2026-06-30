import * as os from "os";
import * as dns from "dns";
import { exec } from "child_process";

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

export interface NetworkInterfaceAddress {
    address: string;
    family: "IPv4" | "IPv6";
    internal: boolean;
    mac?: string;
}

export interface NetworkInterface {
    name: string;
    addresses: NetworkInterfaceAddress[];
}

export interface TracerouteHop {
    hop: string;
    ip: string;
    time: string;
}

export interface ArpEntry {
    ip: string;
    mac: string;
}

export interface ScannerTransport {
    listInterfaces(): Promise<NetworkInterface[]>;
    getDefaultGateway(): Promise<string | null>;
    traceroute(host: string): Promise<TracerouteHop[]>;
    resolveDnsServers(): Promise<string[]>;
    listArpTable(): Promise<ArpEntry[]>;
}

/**
 * Platform-aware network topology scanner transport.
 * Uses Node.js built-in modules and system commands.
 */
export class NodeTopologyScanner implements ScannerTransport {
    async listInterfaces(): Promise<NetworkInterface[]> {
        const ifaces = os.networkInterfaces();
        const result: NetworkInterface[] = [];
        for (const [name, addrs] of Object.entries(ifaces)) {
            if (!addrs) continue;
            result.push({
                name,
                addresses: addrs.map((addr) => ({
                    address: addr.address,
                    family: addr.family,
                    internal: addr.internal,
                    mac: addr.mac,
                })),
            });
        }
        return result;
    }

    async getDefaultGateway(): Promise<string | null> {
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
        return gw;
    }

    async traceroute(host: string): Promise<TracerouteHop[]> {
        const platform = process.platform;
        let cmd: string;
        if (platform === "win32") {
            cmd = `tracert -d -h 10 -w 1000 ${host}`;
        } else {
            cmd = `traceroute -n -m 10 -w 1 ${host} 2>/dev/null`;
        }

        const out = await execAsync(cmd);
        const lines = out.split("\n").slice(1);
        const hops: TracerouteHop[] = [];

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

        return hops;
    }

    async resolveDnsServers(): Promise<string[]> {
        return dns.getServers();
    }

    async listArpTable(): Promise<ArpEntry[]> {
        const platform = process.platform;
        let cmd: string;
        if (platform === "win32") {
            cmd = "arp -a";
        } else {
            cmd = "arp -a 2>/dev/null";
        }

        const out = await execAsync(cmd);
        const lines = out.split("\n");
        const entries: ArpEntry[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const macMatch = trimmed.match(
                /\(([\d.]+)\)\s+at\s+([0-9a-f:]+)/i
            );
            if (macMatch) {
                entries.push({
                    ip: macMatch[1],
                    mac: macMatch[2],
                });
                continue;
            }

            const winMatch = trimmed.match(
                /^([\d.]+)\s+([0-9a-f-]+)\s+/i
            );
            if (winMatch) {
                entries.push({
                    ip: winMatch[1],
                    mac: winMatch[2].replace(/-/g, ":"),
                });
            }
        }

        return entries;
    }
}