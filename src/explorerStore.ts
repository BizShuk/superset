import type { ExplorerChange, ExplorerListener, ExplorerNode } from "./types";

export interface FsAdapter {
    readDirectory(
        uri: string
    ): Promise<Array<{ name: string; isDirectory: boolean }>>;
    getWorkspaceRoots(): string[];
    onDidChangeWorkspace(cb: () => void): () => void;
    onDidChangeFiles(cb: (uris: string[]) => void): () => void;
}

export class ExplorerStore {
    private nodes = new Map<string, ExplorerNode>();
    private listeners = new Set<ExplorerListener>();
    private unsubscribeWorkspace?: () => void;
    private unsubscribeFiles?: () => void;

    constructor(private readonly fs: FsAdapter) {}

    // ── Lifecycle ──────────────────────────────────────────

    start(): void {
        if (this.unsubscribeWorkspace) return;
        this.unsubscribeWorkspace = this.fs.onDidChangeWorkspace(() => {
            this.nodes.clear();
            this.emit({ type: "rootChanged" });
        });
        this.unsubscribeFiles = this.fs.onDidChangeFiles((uris) => {
            for (const uri of uris) {
                this.nodes.delete(uri);
                this.emit({ type: "nodeRemoved", uri });
            }
        });
    }

    stop(): void {
        this.unsubscribeWorkspace?.();
        this.unsubscribeWorkspace = undefined;
        this.unsubscribeFiles?.();
        this.unsubscribeFiles = undefined;
    }

    // ── Reads ──────────────────────────────────────────────

    getRoots(): ExplorerNode[] {
        const roots = this.fs.getWorkspaceRoots();
        return roots.map((uri) => this.getOrCreateNode(uri, true));
    }

    async getChildren(uri: string): Promise<ExplorerNode[]> {
        let node = this.nodes.get(uri);
        if (node && node.children !== undefined) {
            return node.children;
        }
        const entries = await this.fs.readDirectory(uri);
        const children: ExplorerNode[] = [];
        for (const e of entries) {
            const childUri = uri.endsWith("/")
                ? `${uri}${e.name}`
                : `${uri}/${e.name}`;
            const child = this.getOrCreateNode(childUri, e.isDirectory);
            children.push(child);
        }
        if (!node) {
            node = this.getOrCreateNode(uri, true);
        }
        node.children = children;
        return children;
    }

    getNode(uri: string): ExplorerNode | undefined {
        return this.nodes.get(uri);
    }

    getParent(uri: string): ExplorerNode | undefined {
        const idx = uri.lastIndexOf("/");
        if (idx <= 0) return undefined;
        const parentUri = uri.slice(0, idx);
        return this.nodes.get(parentUri);
    }

    // ── Mutations ──────────────────────────────────────────

    refresh(uri: string): void {
        const node = this.nodes.get(uri);
        if (node) {
            node.children = undefined;
        }
        this.nodes.delete(uri);
        this.emit({ type: "nodeChanged", uri });
    }

    refreshAll(): void {
        this.nodes.clear();
        this.emit({ type: "rootChanged" });
    }

    // ── Events ─────────────────────────────────────────────

    onDidChange(listener: ExplorerListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    // ── Private ────────────────────────────────────────────

    private getOrCreateNode(
        uri: string,
        isDirectory: boolean
    ): ExplorerNode {
        let node = this.nodes.get(uri);
        if (!node) {
            const name = uri.split("/").pop() ?? uri;
            node = { uri, name, isDirectory };
            this.nodes.set(uri, node);
        }
        return node;
    }

    private emit(change: ExplorerChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }
}