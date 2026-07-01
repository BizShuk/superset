// MdnsStore — owns the `services` map, the secondary network-key
// dedup indexes, and the per-service detail cache. It is *pure state*:
// it never reaches for timers or network. The registry calls
// `upsert(record)` after a coalesce flush and `remove(key)` after
// expiry; in return the store emits no events of its own (the
// registry is the only place that fans out to listeners — keeping
// the event vocabulary centralised).

import type { MdnsService } from "./types";
import { networkKey, mergeServices } from "./mdnsDedup";
import { DetailCache } from "./mdnsDetailCache";
import { buildMdnsDetailFields, type MdnsDetailField } from "./mdnsTreeSpec";

export type UpsertResult =
    | { kind: "added"; service: MdnsService }
    | { kind: "updated"; service: MdnsService };

export class MdnsStore {
    private services = new Map<string, MdnsService>();
    private byNetworkKey = new Map<string, string>();
    private canonKeyToNk = new Map<string, Set<string>>();
    private readonly detailCache = new DetailCache<MdnsDetailField[]>(60_000);

    /** All services currently in the store, in insertion order. */
    getAll(): MdnsService[] {
        return Array.from(this.services.values());
    }

    getByKey(key: string): MdnsService | undefined {
        return this.services.get(key);
    }

    /**
     * Insert a freshly-coalesced service, merging into an existing
     * canonical row when the network key (`host|port|type`) collides.
     * Returns the outcome so the registry can emit the right event.
     */
    upsert(key: string, service: MdnsService): UpsertResult {
        const nk = networkKey(service);
        const canonKey = this.byNetworkKey.get(nk);
        const resolvedKey =
            canonKey ?? (this.services.has(key) ? key : undefined);

        if (resolvedKey) {
            const existing = this.services.get(resolvedKey);
            const merged = existing ? mergeServices(existing, service) : service;
            this.services.set(resolvedKey, merged);

            if (resolvedKey !== key) {
                this.services.delete(key);
            }

            // Release any network keys the canonical row used to own
            // that no longer match the new port — prevents a future
            // unrelated service from accidentally claiming the slot.
            const oldNks = this.canonKeyToNk.get(resolvedKey);
            if (oldNks) {
                const [newId, newPort, newType] = nk.split("|");
                for (const oldNk of Array.from(oldNks)) {
                    if (oldNk !== nk) {
                        const [oldId, oldPort, oldType] = oldNk.split("|");
                        if (
                            oldId === newId &&
                            oldType === newType &&
                            oldPort !== newPort
                        ) {
                            this.byNetworkKey.delete(oldNk);
                            oldNks.delete(oldNk);
                        }
                    }
                }
            }

            this.byNetworkKey.set(nk, resolvedKey);
            let nks = this.canonKeyToNk.get(resolvedKey);
            if (!nks) {
                nks = new Set<string>();
                this.canonKeyToNk.set(resolvedKey, nks);
            }
            nks.add(nk);

            return { kind: "updated", service: merged };
        }

        // First sight of this endpoint and name.
        this.services.set(key, service);
        this.byNetworkKey.set(nk, key);
        this.canonKeyToNk.set(key, new Set<string>([nk]));
        return { kind: "added", service };
    }

    /**
     * Remove a service by its canonical key. Returns the removed
     * service so the registry can emit `expired` and invalidate
     * detail cache. Cleans up the dedup indexes alongside the row.
     */
    remove(key: string): MdnsService | undefined {
        const svc = this.services.get(key);
        if (!svc) return undefined;
        this.services.delete(key);
        this.invalidateDetail(svc);
        const nks = this.canonKeyToNk.get(key);
        if (nks) {
            for (const n of nks) {
                this.byNetworkKey.delete(n);
            }
            this.canonKeyToNk.delete(key);
        }
        return svc;
    }

    /** Drop every service and reset all indexes. Used by `reset()`. */
    clear(): void {
        this.services.clear();
        this.byNetworkKey.clear();
        this.canonKeyToNk.clear();
        this.detailCache.clear();
    }

    // ── Detail cache ───────────────────────────────────────

    getDetailCached(
        svc: Pick<MdnsService, "name" | "type" | "host" | "port">
    ): { hit: boolean; detail: MdnsDetailField[] } {
        const key = `${svc.name}|${svc.type}|${svc.host ?? ""}|${svc.port}`;
        const cached = this.detailCache.get(key);
        if (cached.hit && cached.value) {
            return { hit: true, detail: cached.value };
        }
        const full = this.getByKey(svc.name);
        const detail = full ? buildMdnsDetailFields(full) : [];
        this.detailCache.set(key, detail);
        return { hit: false, detail };
    }

    invalidateDetail(
        svc: Pick<MdnsService, "name" | "type" | "host" | "port">
    ): void {
        const key = `${svc.name}|${svc.type}|${svc.host ?? ""}|${svc.port}`;
        this.detailCache.invalidate(key);
    }
}
