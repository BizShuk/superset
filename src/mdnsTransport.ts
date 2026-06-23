import mDNS from "multicast-dns";
import type { Packet } from "dns-packet";

interface RawAnswer {
    name: string;
    type: string;
    ttl?: number;
    data?: unknown;
}

export interface MdnsPacket {
    answers: Array<{
        name: string;
        type: string;
        ttl: number;
        data: unknown;
    }>;
    additionals?: Array<{
        name: string;
        type: string;
        ttl: number;
        data: unknown;
    }>;
}

export interface MdnsTransport {
    start(): void;
    stop(): void;
    browse(): void;
    onPacket(cb: (pkt: MdnsPacket) => void): () => void;
}

function normalizeAnswer(a: RawAnswer): {
    name: string;
    type: string;
    ttl: number;
    data: unknown;
} {
    return {
        name: a.name,
        type: a.type,
        ttl: a.ttl ?? 0,
        data: a.data ?? null,
    };
}

/**
 * Real mDNS transport backed by the `multicast-dns` npm package.
 * Pure JS, no native dependencies — works on macOS, Windows, and Linux.
 */
export class MulticastDnsTransport implements MdnsTransport {
    private mdns?: mDNS.MulticastDNS;
    private listeners: Array<(pkt: MdnsPacket) => void> = [];
    private started = false;

    start(): void {
        if (this.started) return;
        this.mdns = mDNS({ loopback: true });
        this.started = true;

        this.mdns.on("response", (response: Packet) => {
            const answers = (response.answers ?? []) as RawAnswer[];
            const additionals = (response.additionals ?? []) as RawAnswer[];
            const pkt: MdnsPacket = {
                answers: answers
                    .filter((a) => a.type !== "OPT")
                    .map(normalizeAnswer),
                additionals: additionals
                    .filter((a) => a.type !== "OPT")
                    .map(normalizeAnswer),
            };
            for (const cb of this.listeners) {
                cb(pkt);
            }
        });

        this.mdns.on("error", (err: Error) => {
            // Silently swallow — mDNS is best-effort.
            console.error(`[mdns transport] error: ${err.message}`);
        });
    }

    stop(): void {
        if (!this.started) return;
        this.mdns?.destroy();
        this.mdns = undefined;
        this.started = false;
    }

    browse(): void {
        if (!this.mdns) return;
        // Query for service types via DNS-SD PTR record.
        this.mdns.query({
            questions: [
                {
                    name: "_services._dns-sd._udp.local",
                    type: "PTR",
                },
            ],
        });
    }

    onPacket(cb: (pkt: MdnsPacket) => void): () => void {
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== cb);
        };
    }
}