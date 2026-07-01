// MdnsExpirationSweeper — periodic TTL grace-period scan. Extracted
// from `MdnsRegistry.expireStale` so the timer + clock + grace-window
// math are all in one place. The sweeper is owned by the registry and
// driven by `start()` / `stop()`. Each tick calls `store.remove(key)`
// for services whose `lastSeen` is older than `ttl ×
// TTL_GRACE_MULTIPLIER` (or `TTL_DEFAULT_SECONDS` when ttl is 0).

import { MdnsStore } from "./store";

/** Grace period as a multiple of a service's TTL (RFC 6762 §10.1 cache-flush). */
export const TTL_GRACE_MULTIPLIER = 3;
/** How often the expiry sweep runs. */
export const EXPIRY_TICK_MS = 5_000;
/** TTL (seconds) assumed when a record arrives without one. */
export const TTL_DEFAULT_SECONDS = 120;

export interface ClockSource {
    now(): number;
}

const DEFAULT_CLOCK: ClockSource = { now: () => Date.now() };

/** Callback the sweeper uses to report an expired service. The
 *  registry passes an emitter-bound function so the event vocabulary
 *  stays centralised. */
export type ExpireListener = (
    service: import("./types").MdnsService
) => void;

export class MdnsExpirationSweeper {
    private timer?: ReturnType<typeof setInterval>;

    constructor(
        private readonly store: MdnsStore,
        private readonly listener: ExpireListener,
        private readonly clock: ClockSource = DEFAULT_CLOCK
    ) {}

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.sweep(), EXPIRY_TICK_MS);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    /**
     * Run one sweep pass. Exposed (in addition to the periodic timer)
     * so the registry can drive it synchronously from `start()` when
     * it wants to drop everything left over from a previous session.
     */
    sweep(): void {
        const now = this.clock.now();
        // Snapshot keys first — `remove()` mutates the store.
        const keys = Array.from(this.store.getAll().map((s) => s.name));
        for (const key of keys) {
            const svc = this.store.getByKey(key);
            if (!svc) continue;
            const ttl = svc.ttl || TTL_DEFAULT_SECONDS;
            const graceMs = ttl * 1000 * TTL_GRACE_MULTIPLIER;
            if (now - svc.lastSeen > graceMs) {
                const removed = this.store.remove(key);
                if (removed) this.listener(removed);
            }
        }
    }
}
