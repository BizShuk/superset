// Cross-cutting framework types shared by the composition root and every
// feature module. Unlike the per-feature `types.ts` files, these describe
// the feature-module contract itself, not any single feature's domain.

import type * as vscode from "vscode";

/**
 * Shared dependencies injected into every feature module by the
 * composition root (extension.ts). Each feature reads what it needs
 * and ignores the rest.
 */
export interface SharedDeps {
    readonly statusBar: vscode.StatusBarItem;
    readonly diag: vscode.OutputChannel;
    readonly log: (msg: string) => void;
}

export interface FeatureContext {
    readonly context: vscode.ExtensionContext;
    readonly subscriptions: vscode.Disposable[];
    readonly workspaceFolder: string;
    readonly shared: SharedDeps;
    readonly resetHandlers: (() => void | Promise<void>)[];
}

export interface FeatureHandle {
    dispose(): void;
}
