import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MdnsRegistry } from "../src/mdns/mdnsRegistry";
import type { MdnsPacket, MdnsTransport } from "../src/mdns/mdnsTransport";
import type { MdnsService } from "../src/mdns/types";

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
    target: string,
    priority: number = 0,
    weight: number = 0
): MdnsPacket["answers"][number] {
    return {
        name,
        type: "SRV",
        ttl: 120,
        data: { port, target, priority, weight },
    };
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
        expect(svc.priority).toBe(0);
        expect(svc.weight).toBe(0);
        expect(svc.ttl).toBe(120);
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

    it("captures SRV priority and weight", async () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        registry.start();

        await transport.feedAndFlush({
            answers: [
                ptrRecord("_http._tcp.local", "Balanced._http._tcp.local"),
                srvRecord("Balanced._http._tcp.local", 80, "host.local", 10, 50),
            ],
        });

        expect(listener).toHaveBeenCalledTimes(1);
        const svc = listener.mock.calls[0][0].service;
        expect(svc.priority).toBe(10);
        expect(svc.weight).toBe(50);
    });

    it("tracks minimum TTL across all records", async () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        registry.start();

        await transport.feedAndFlush({
            answers: [
                { name: "_http._tcp.local", type: "PTR", ttl: 300, data: "Svc._http._tcp.local" },
                { name: "Svc._http._tcp.local", type: "SRV", ttl: 60, data: { port: 80, target: "host.local" } },
                { name: "Svc._http._tcp.local", type: "TXT", ttl: 120, data: {} },
            ],
        });

        expect(listener).toHaveBeenCalledTimes(1);
        const svc = listener.mock.calls[0][0].service;
        expect(svc.ttl).toBe(60); // min of 300, 60, 120
    });

    it("extracts subtypes from PTR records", async () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        registry.start();

        await transport.feedAndFlush({
            answers: [
                ptrRecord(
                    "_printer._sub._http._tcp.local",
                    "MyPrinter._http._tcp.local"
                ),
                srvRecord("MyPrinter._http._tcp.local", 631, "printer.local"),
            ],
        });

        expect(listener).toHaveBeenCalledTimes(1);
        const svc = listener.mock.calls[0][0].service;
        expect(svc.type).toBe("_http._tcp");
        expect(svc.subtypes).toContain("_printer");
    });

    it("records srcAddress from packet", async () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        registry.start();

        await transport.feedAndFlush({
            answers: [
                ptrRecord("_http._tcp.local", "Svc._http._tcp.local"),
                srvRecord("Svc._http._tcp.local", 80, "host.local"),
            ],
            srcAddress: "192.168.1.100",
        });

        const svc = listener.mock.calls[0][0].service;
        expect(svc.srcAddress).toBe("192.168.1.100");
    });

    it("dedupes by network key when two names share host|port|type", async () => {
        const listener = vi.fn();
        registry.onDidChange(listener);
        registry.start();

        // First instance name — becomes the canonical row.
        await transport.feedAndFlush({
            answers: [
                ptrRecord("_ipp._tcp.local", "Printer._ipp._tcp.local"),
                srvRecord("Printer._ipp._tcp.local", 631, "printer.local"),
                aRecord("printer.local", "10.0.0.1"),
            ],
        });
        // Second instance name, SAME host:port:type → must merge, not duplicate.
        await transport.feedAndFlush({
            answers: [
                ptrRecord("_ipp._tcp.local", "Printer-Alt._ipp._tcp.local"),
                srvRecord("Printer-Alt._ipp._tcp.local", 631, "printer.local"),
                aRecord("printer.local", "10.0.0.2"),
            ],
        });

        const all = registry.getAll();
        expect(all.length).toBe(1);
        expect(all[0].name).toBe("Printer._ipp._tcp.local");
        expect(all[0].aliases).toContain("Printer-Alt._ipp._tcp.local");
        expect(all[0].addresses).toEqual(
            expect.arrayContaining(["10.0.0.1", "10.0.0.2"])
        );
        // Second sighting emits an update against the canonical row, not a new add.
        const types = listener.mock.calls.map((c) => c[0].type);
        expect(types).toEqual(["added", "updated"]);
    });

    it("keeps first-seen name canonical regardless of arrival order", async () => {
        registry.start();

        // Alt name arrives first → it becomes canonical.
        await transport.feedAndFlush({
            answers: [
                ptrRecord("_ipp._tcp.local", "Z-Printer._ipp._tcp.local"),
                srvRecord("Z-Printer._ipp._tcp.local", 631, "printer.local"),
            ],
        });
        await transport.feedAndFlush({
            answers: [
                ptrRecord("_ipp._tcp.local", "A-Printer._ipp._tcp.local"),
                srvRecord("A-Printer._ipp._tcp.local", 631, "printer.local"),
            ],
        });

        const all = registry.getAll();
        expect(all.length).toBe(1);
        expect(all[0].name).toBe("Z-Printer._ipp._tcp.local");
        expect(all[0].aliases).toContain("A-Printer._ipp._tcp.local");
    });

    it("getDetailCached returns same value on second call within TTL", async () => {
        registry.start();
        await transport.feedAndFlush({
            answers: [
                ptrRecord("_ipp._tcp.local", "Printer._ipp._tcp.local"),
                srvRecord("Printer._ipp._tcp.local", 631, "printer.local"),
            ],
        });

        const svc = registry.getByKey("Printer._ipp._tcp.local");
        expect(svc).toBeDefined();
        if (!svc) return;

        const a = registry.getDetailCached(svc);
        expect(a.hit).toBe(false);
        expect(a.detail.length).toBeGreaterThan(0);

        const b = registry.getDetailCached(svc);
        expect(b.hit).toBe(true);
        expect(b.detail).toEqual(a.detail);
    });

    it("invalidateDetail invalidates the cache", async () => {
        registry.start();
        await transport.feedAndFlush({
            answers: [
                ptrRecord("_ipp._tcp.local", "Printer._ipp._tcp.local"),
                srvRecord("Printer._ipp._tcp.local", 631, "printer.local"),
            ],
        });

        const svc = registry.getByKey("Printer._ipp._tcp.local");
        expect(svc).toBeDefined();
        if (!svc) return;

        const a = registry.getDetailCached(svc);
        expect(a.hit).toBe(false);

        registry.invalidateDetail(svc);

        const b = registry.getDetailCached(svc);
        expect(b.hit).toBe(false);
    });
});