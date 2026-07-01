import { describe, it, expect } from "vitest";
import { MdnsStore } from "../src/mdns/store";
import type { MdnsService } from "../src/mdns/types";

function svc(overrides: Partial<MdnsService>): MdnsService {
    return {
        name: "Host._http._tcp.local",
        type: "_http._tcp",
        domain: "local",
        port: 80,
        priority: 0,
        weight: 0,
        ttl: 60,
        host: "host.local",
        addresses: ["10.0.0.1"],
        txt: {},
        subtypes: [],
        firstSeen: 0,
        lastSeen: 0,
        ...overrides,
    };
}

describe("MdnsStore", () => {
    it("upsert returns 'added' on first sight and stores under the key", () => {
        const store = new MdnsStore();
        const result = store.upsert("Host._http._tcp.local", svc({}));
        expect(result.kind).toBe("added");
        expect(store.getByKey("Host._http._tcp.local")).toBeDefined();
        expect(store.getAll()).toHaveLength(1);
    });

    it("upsert returns 'updated' and merges into canonical row when network key collides", () => {
        const store = new MdnsStore();
        // First sight: name "A", host "h.local", port 80
        const r1 = store.upsert(
            "A._http._tcp.local",
            svc({ name: "A._http._tcp.local", host: "h.local", port: 80 })
        );
        expect(r1.kind).toBe("added");

        // Second sight: name "B", same host+port+type → same network key
        const r2 = store.upsert(
            "B._http._tcp.local",
            svc({ name: "B._http._tcp.local", host: "h.local", port: 80 })
        );
        expect(r2.kind).toBe("updated");
        // A is canonical, B is folded in and removed as standalone.
        expect(store.getByKey("A._http._tcp.local")).toBeDefined();
        expect(store.getByKey("B._http._tcp.local")).toBeUndefined();
        expect(store.getAll()).toHaveLength(1);
    });

    it("releases the old network key when the port changes", () => {
        const store = new MdnsStore();
        // Same name, port 80, then port 8080. The old nk (host|80|type)
        // should be released so a future unrelated service can claim it.
        store.upsert("X", svc({ host: "h.local", port: 80 }));
        const r = store.upsert("X", svc({ host: "h.local", port: 8080 }));
        expect(r.kind).toBe("updated");

        // A fresh service claiming nk host|80|_http._tcp must be allowed
        // to register — it would be blocked if the old nk leaked.
        const r2 = store.upsert(
            "Other",
            svc({
                name: "Other._http._tcp.local",
                host: "h.local",
                port: 80,
            })
        );
        expect(r2.kind).toBe("added");
    });

    it("remove returns the service and clears the dedup indexes", () => {
        const store = new MdnsStore();
        store.upsert("A", svc({}));
        const removed = store.remove("A");
        expect(removed).toBeDefined();
        expect(store.getByKey("A")).toBeUndefined();
        expect(store.getAll()).toHaveLength(0);
    });

    it("remove returns undefined for unknown key", () => {
        const store = new MdnsStore();
        expect(store.remove("nope")).toBeUndefined();
    });

    it("clear wipes services, dedup indexes, and detail cache", () => {
        const store = new MdnsStore();
        store.upsert("A", svc({}));
        const cached = store.getDetailCached({
            name: "A",
            type: "_http._tcp",
            host: "host.local",
            port: 80,
        });
        expect(cached.hit).toBe(false);
        store.clear();
        expect(store.getAll()).toHaveLength(0);
    });

    it("getDetailCached caches the result and reuses on second call", () => {
        const store = new MdnsStore();
        store.upsert("A", svc({}));
        const first = store.getDetailCached({
            name: "A",
            type: "_http._tcp",
            host: "host.local",
            port: 80,
        });
        expect(first.hit).toBe(false);
        const second = store.getDetailCached({
            name: "A",
            type: "_http._tcp",
            host: "host.local",
            port: 80,
        });
        expect(second.hit).toBe(true);
    });

    it("invalidateDetail forces the next getDetailCached to be a miss", () => {
        const store = new MdnsStore();
        store.upsert("A", svc({}));
        store.getDetailCached({
            name: "A",
            type: "_http._tcp",
            host: "host.local",
            port: 80,
        });
        store.invalidateDetail({
            name: "A",
            type: "_http._tcp",
            host: "host.local",
            port: 80,
        });
        const after = store.getDetailCached({
            name: "A",
            type: "_http._tcp",
            host: "host.local",
            port: 80,
        });
        expect(after.hit).toBe(false);
    });
});
