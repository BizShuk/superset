export interface CacheResult<T> {
    readonly hit: boolean;
    readonly value?: T;
}

export class DetailCache<T> {
    private store = new Map<string, { value: T; expires: number }>();

    constructor(private readonly ttlMs: number) {}

    public get(key: string): CacheResult<T> {
        const entry = this.store.get(key);
        if (!entry) return { hit: false };
        if (entry.expires <= Date.now()) {
            this.store.delete(key);
            return { hit: false };
        }
        return { hit: true, value: entry.value };
    }

    public set(key: string, value: T): void {
        this.store.set(key, { value, expires: Date.now() + this.ttlMs });
    }

    public invalidate(key: string): void {
        this.store.delete(key);
    }
}
