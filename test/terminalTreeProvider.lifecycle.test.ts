import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
    class EventEmitter<T> {
        private readonly listeners = new Set<(value: T) => void>();

        readonly event = (listener: (value: T) => void) => {
            this.listeners.add(listener);
            return {
                dispose: () => this.listeners.delete(listener),
            };
        };

        fire(value: T): void {
            for (const listener of this.listeners) listener(value);
        }

        dispose(): void {
            this.listeners.clear();
        }
    }

    return {
        EventEmitter,
        TreeItem: class TreeItem {},
        ThemeIcon: class ThemeIcon {},
        TreeItemCollapsibleState: {
            None: 0,
            Collapsed: 1,
            Expanded: 2,
        },
    };
});

import { GroupStore } from "../src/terminals/groupStore";
import { TerminalRegistry } from "../src/terminals/terminalRegistry";
import { TerminalTreeProvider } from "../src/terminals/treeProvider";

describe("TerminalTreeProvider visibility lifecycle", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("runs periodic rename refreshes only while the Tree View is visible", () => {
        const provider = new TerminalTreeProvider(
            new TerminalRegistry(),
            new GroupStore(),
            3_000
        );
        const refreshes: unknown[] = [];
        const subscription = provider.onDidChangeTreeData((event) => {
            refreshes.push(event);
        });

        provider.start();
        vi.advanceTimersByTime(3_000);
        expect(refreshes).toHaveLength(0);

        provider.setVisible(true);
        vi.advanceTimersByTime(3_000);
        expect(refreshes).toHaveLength(1);

        provider.setVisible(false);
        vi.advanceTimersByTime(3_000);
        expect(refreshes).toHaveLength(1);

        subscription.dispose();
        provider.stop();
    });
});
