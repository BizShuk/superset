import type { RegistryChange, RegistryListener, TerminalHandle } from "./types";

interface Entry {
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
        this.entries.set(terminal, { terminal, hasUnseenOutput: false });
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

    getAll(): TerminalHandle[] {
        return Array.from(this.entries.keys());
    }

    getUnseen(): TerminalHandle[] {
        const result: TerminalHandle[] = [];
        for (const entry of this.entries.values()) {
            if (entry.hasUnseenOutput) {
                result.push(entry.terminal);
            }
        }
        return result;
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
