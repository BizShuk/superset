import type {
    ScannerTransport,
    NetworkInterface,
    TracerouteHop,
    ArpEntry,
} from "../src/topology/topologyScanner";

export class FakeTopologyScanner implements ScannerTransport {
    public interfaces: NetworkInterface[] = [];
    public gateway: string | null = null;
    public hops: TracerouteHop[] = [];
    public dnsServers: string[] = [];
    public arpTable: ArpEntry[] = [];

    public errorToThrow: Error | null = null;

    public listInterfacesCalls = 0;
    public getDefaultGatewayCalls = 0;
    public tracerouteCalls = 0;
    public resolveDnsServersCalls = 0;
    public listArpTableCalls = 0;

    public delayMs = 0;

    private async maybeDelay(): Promise<void> {
        if (this.delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.delayMs));
        }
        if (this.errorToThrow) {
            throw this.errorToThrow;
        }
    }

    async listInterfaces(): Promise<NetworkInterface[]> {
        this.listInterfacesCalls++;
        await this.maybeDelay();
        return this.interfaces;
    }

    async getDefaultGateway(): Promise<string | null> {
        this.getDefaultGatewayCalls++;
        await this.maybeDelay();
        return this.gateway;
    }

    async traceroute(host: string): Promise<TracerouteHop[]> {
        this.tracerouteCalls++;
        await this.maybeDelay();
        return this.hops;
    }

    async resolveDnsServers(): Promise<string[]> {
        this.resolveDnsServersCalls++;
        await this.maybeDelay();
        return this.dnsServers;
    }

    async listArpTable(): Promise<ArpEntry[]> {
        this.listArpTableCalls++;
        await this.maybeDelay();
        return this.arpTable;
    }
}
