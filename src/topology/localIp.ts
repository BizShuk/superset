import type { NetworkInterface } from "./topologyScanner";

/**
 * Pick the host's IPv4 address that should appear as hop 0 in a traceroute.
 *
 * Preference order:
 *   1. Non-internal IPv4 sharing the /24 with `gateway`
 *   2. First non-internal IPv4
 *   3. `null` (only loopback / IPv6 / no interfaces)
 *
 * Subnet match against the gateway is the right heuristic on a multi-NIC host
 * (e.g. laptop on Wi-Fi + Ethernet + VPN): the gateway reveals which NIC the
 * default route actually exits through, so we surface that NIC's IP.
 *
 * Pure function — no `vscode` import, fully unit-testable.
 */
export function deriveLocalIp(
    interfaces: NetworkInterface[],
    gateway: string | null,
): string | null {
    if (!interfaces || interfaces.length === 0) return null;

    const ipv4s: string[] = [];
    for (const iface of interfaces) {
        for (const addr of iface.addresses ?? []) {
            if (addr.family === "IPv4" && !addr.internal) {
                ipv4s.push(addr.address);
            }
        }
    }
    if (ipv4s.length === 0) return null;

    const gwParts =
        gateway && /^\d+\.\d+\.\d+\.\d+$/.test(gateway)
            ? gateway.split(".")
            : null;
    if (gwParts && gwParts.length === 4) {
        const match = ipv4s.find((ip) => {
            const parts = ip.split(".");
            return (
                parts.length === 4 &&
                parts[0] === gwParts[0] &&
                parts[1] === gwParts[1] &&
                parts[2] === gwParts[2]
            );
        });
        if (match) return match;
    }

    return ipv4s[0];
}