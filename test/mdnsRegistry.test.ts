import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MdnsRegistry } from "../src/mdnsRegistry";
import type { MdnsPacket, MdnsTransport } from "../src/mdnsTransport";
import type { MdnsService } from "../src/types";

class FakeMdnsTransport implements MdnsTransport {
    private listeners: Array<(pkt: MdnsPacket) => void> = [];
    started = false;
    browseCalled = false;

    start(): void {
        this.started = true;
    }
    stop(): void {
        this.started = false;
    }
    browse(): void {
        this.browseCalled = true;
    }
    onPacket(cb: (pkt: MdnsPacket) => void): () => void {
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== cb);
        };
    }
    /** Feed a packet to all registered listeners. */
    feed(pkt: MdnsPacket): void {
        for (const cb of this.listeners) {
            cb(pkt);
        }
    }
    /** Feed and wait for the 250ms coalesce debounce. */
    async feedAndFlush(pkt: MdnsPacket): Promise<void> {
        this.feed(pkt);
        await new Promise((r) => setTimeout(r, 300));
    }
}

function ptrRecord(
    name: string,
    data: string
): MdnsPacket["answers"][number] {
    return { name, type: "PTR", ttl: 120, data };
}

function srvRecord(
    name: string,
    port: number,
    target: string
): MdnsPacket["answers"][number] {
    return { name, type: "SRV", ttl: 120, data: { port, target } };
}

function txtRecord(
    name: string,
    data: Record<string, string>
): MdnsPacket["answers"][number] {
    return { name, type: "TXT", ttl: 120, data };
}

function aRecord(
    name: string,
    data: string
): MdnsPacket["answers"][number] {
    return { name, type: "A", ttl: 120, data };
}

describe("MdnsRegistry", () => {
    let transport: FakeMdnsTransport;
    let registry: MdnsRegistry;

    beforeEach(() => {
        transport = new FakeMdnsTransport();
        registry = new MdnsRegistry(transport);
    });

    afterEach(() => {
        registry.stop();
    });

    it("starts transport and browses on start()", () => {
        registry.start();
        expect(transport.started).toBe(true);
        expect(transport.browseCalled).toBe(true);
    });

    it("stops transport on stop()", () => {
        registry.start();
        registry.stop();
        expect(transport.started).toBe(false);
    });

    it("start is idempotent", () => {
        registry.start();
        registry.start();
        // Still only one transport started
        expect(transport.started).toBe(true);
    });

    it("emits 'added' when a new service is discovered", async () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        registry.start();

        await transport.feedAndFlush({
            answers: [
                ptrRecord("_http._tcp.local", "MyServer._http._tcp.local"),
                srvRecord("MyServer._http._tcp.local", 8080, "myserver.local"),
                aRecord("myserver.local", "192.168.1.42"),
                txtRecord("MyServer._http._tcp.local", { path: "/api" }),
            ],
        });

        expect(listener).toHaveBeenCalledTimes(1);
        const call = listener.mock.calls[0][0];
        expect(call.type).toBe("added");
        const svc = call.service;
        expect(svc.name).toContain("MyServer");
        expect(svc.port).toBe(8080);
        expect(svc.addresses).toContain("192.168.1.42");
        expect(svc.txt).toEqual({ path: "/api" });
    });

    it("emits 'updated' when an existing service is re-discovered", async () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        registry.start();

        // First discovery
        await transport.feedAndFlush({
            answers: [
                ptrRecord("_http._tcp.local", "MyServer._http._tcp.local"),
                srvRecord("MyServer._http._tcp.local", 8080, "myserver.local"),
                aRecord("myserver.local", "192.168.1.42"),
            ],
        });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0].type).toBe("added");

        // Same service re-discovered with different port
        await transport.feedAndFlush({
            answers: [
                ptrRecord("_http._tcp.local", "MyServer._http._tcp.local"),
                srvRecord("MyServer._http._tcp.local", 9090, "myserver.local"),
                aRecord("myserver.local", "192.168.1.42"),
            ],
        });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener.mock.calls[1][0].type).toBe("updated");
        expect(listener.mock.calls[1][0].service.port).toBe(9090);
    });

    it("getAll returns all discovered services", async () => {
        registry.start();
        await transport.feedAndFlush({
            answers: [
                ptrRecord("_http._tcp.local", "Svc1._http._tcp.local"),
                srvRecord("Svc1._http._tcp.local", 80, "host1.local"),
                ptrRecord("_ssh._tcp.local", "Svc2._ssh._tcp.local"),
                srvRecord("Svc2._ssh._tcp.local", 22, "host2.local"),
            ],
        });
        const all = registry.getAll();
        expect(all.length).toBe(2);
    });

    it("refresh calls transport.browse()", () => {
        registry.start();
        transport.browseCalled = false;
        registry.refresh();
        expect(transport.browseCalled).toBe(true);
    });

    it("listener unsubscribe stops events", async () => {
        const listener = vi.fn();
        const off = registry.onDidChange(listener);
        off();
        registry.start();

        await transport.feedAndFlush({
            answers: [
                ptrRecord("_http._tcp.local", "Svc._http._tcp.local"),
                srvRecord("Svc._http._tcp.local", 80, "host.local"),
            ],
        });

        expect(listener).not.toHaveBeenCalled();
    });

    it("getByKey returns undefined for unknown key", () => {
        expect(registry.getByKey("nonexistent")).toBeUndefined();
    });
});