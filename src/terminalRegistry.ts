import type {
    RegistryChange,
    RegistryListener,
    TerminalEntry,
    TerminalHandle,
    TerminalId,
} from "./types";

interface Entry {
    id: TerminalId;
    terminal: TerminalHandle;
    hasUnseenOutput: boolean;
}

export class TerminalRegistry {
    private entries = new Map<TerminalHandle, Entry>();
    private listeners = new Set<RegistryListener>();

    add(terminal: TerminalHandle): void {
        if (this.entries.has(terminal)) {
            return;
        }
        const procId = (terminal as unknown as { processId?: number }).processId;
        const id: TerminalId =
            procId !== undefined
                ? String(procId)
                : `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        this.entries.set(terminal, { id, terminal, hasUnseenOutput: false });
        this.emit({ type: "added", terminal });
    }

    remove(terminal: TerminalHandle): void {
        if (!this.entries.delete(terminal)) {
            return;
        }
        this.emit({ type: "removed", terminal });
    }

    has(terminal: TerminalHandle): boolean {
        return this.entries.has(terminal);
    }

    isUnseen(terminal: TerminalHandle): boolean {
        return this.entries.get(terminal)?.hasUnseenOutput ?? false;
    }

    markUnseen(terminal: TerminalHandle): void {
        const entry = this.entries.get(terminal);
        if (!entry || entry.hasUnseenOutput) {
            return;
        }
        entry.hasUnseenOutput = true;
        this.emit({ type: "unseenChanged", terminal, hasUnseenOutput: true });
    }

    clearUnseen(terminal: TerminalHandle): void {
        const entry = this.entries.get(terminal);
        if (!entry || !entry.hasUnseenOutput) {
            return;
        }
        entry.hasUnseenOutput = false;
        this.emit({ type: "unseenChanged", terminal, hasUnseenOutput: false });
    }

    getAll(): TerminalEntry[] {
        return Array.from(this.entries.values()).map((e) => ({
            id: e.id,
            terminal: e.terminal,
            hasUnseenOutput: e.hasUnseenOutput,
        }));
    }

    getUnseen(): TerminalEntry[] {
        const result: TerminalEntry[] = [];
        for (const e of this.entries.values()) {
            if (e.hasUnseenOutput) {
                result.push({ id: e.id, terminal: e.terminal, hasUnseenOutput: true });
            }
        }
        return result;
    }

    getById(id: TerminalId): TerminalEntry | undefined {
        for (const e of this.entries.values()) {
            if (e.id === id) {
                return { id: e.id, terminal: e.terminal, hasUnseenOutput: e.hasUnseenOutput };
            }
        }
        return undefined;
    }

    getEntryByTerminal(terminal: TerminalHandle): TerminalEntry | undefined {
        const e = this.entries.get(terminal);
        return e ? { id: e.id, terminal: e.terminal, hasUnseenOutput: e.hasUnseenOutput } : undefined;
    }

    onDidChange(listener: RegistryListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(change: RegistryChange): void {
        for (const listener of this.listeners) {
            listener(change);
        }
    }
}
