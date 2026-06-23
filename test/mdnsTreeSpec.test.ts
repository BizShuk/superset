import { describe, it, expect } from "vitest";
import {
    buildMdnsServiceSpec,
    buildMdnsTypeSpec,
} from "../src/mdnsTreeSpec";
import type { MdnsService } from "../src/types";

function fakeService(overrides: Partial<MdnsService> = {}): MdnsService {
    return {
        name: "MyService._http._tcp.local",
        type: "_http._tcp",
        domain: "local",
        port: 8080,
        host: "myserver.local",
        addresses: ["192.168.1.42"],
        txt: { path: "/api" },
        firstSeen: 1000,
        lastSeen: 2000,
        ...overrides,
    };
}

describe("buildMdnsServiceSpec", () => {
    it("shows name as label and host:port as description", () => {
        const svc = fakeService();
        const spec = buildMdnsServiceSpec(svc);
        expect(spec.label).toBe("MyService._http._tcp.local");
        expect(spec.description).toBe("myserver.local:8080");
        expect(spec.iconKind).toBe("service");
        expect(spec.contextValue).toBe("mdnsService");
    });

    it("uses first address when host is undefined", () => {
        const svc = fakeService({ host: undefined, addresses: ["10.0.0.1"] });
        const spec = buildMdnsServiceSpec(svc);
        expect(spec.description).toBe("10.0.0.1:8080");
    });

    it("shows ? when no host and no addresses", () => {
        const svc = fakeService({ host: undefined, addresses: [] });
        const spec = buildMdnsServiceSpec(svc);
        expect(spec.description).toBe("?");
    });

    it("omits port when port is 0", () => {
        const svc = fakeService({ port: 0 });
        const spec = buildMdnsServiceSpec(svc);
        expect(spec.description).toBe("myserver.local");
    });
});

describe("buildMdnsTypeSpec", () => {
    it("shows type name as label and service count as description", () => {
        const svc = fakeService();
        const group = { type: "_http._tcp", services: [svc, svc] };
        const spec = buildMdnsTypeSpec(group);
        expect(spec.label).toBe("_http._tcp");
        expect(spec.description).toBe("2 個服務");
        expect(spec.iconKind).toBe("serviceType");
        expect(spec.contextValue).toBe("mdnsType");
    });
});